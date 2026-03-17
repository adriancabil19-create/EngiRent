import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import axios from 'axios';
import env from '../config/env';

// --- Fix 1: Image download helper ---
// The ML service expects actual file uploads (UploadFile / multipart bytes).
// Passing URL strings fails FastAPI's File(...) validation with HTTP 422.
// This helper downloads each image URL to a Blob for proper multipart upload.
async function downloadImageAsBlob(url: string): Promise<Blob | null> {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return new Blob([response.data as ArrayBuffer], { type: 'image/jpeg' });
  } catch {
    logger.warn(`Could not download image for ML verification: ${url}`);
    return null;
  }
}

export const depositItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { rentalId, lockerId, images } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    if (rental.ownerId !== req.user.userId) {
      throw new ForbiddenError('Only the owner can deposit the item');
    }

    if (rental.status !== 'AWAITING_DEPOSIT') {
      throw new ValidationError('Rental is not awaiting deposit');
    }

    const locker = await prisma.locker.findUnique({
      where: { id: lockerId },
    });

    if (!locker || locker.status !== 'AVAILABLE') {
      throw new ValidationError('Locker is not available');
    }

    // Lock the locker while the owner places the item
    await prisma.locker.update({
      where: { id: lockerId },
      data: { status: 'OCCUPIED', currentRentalId: rentalId, lastUsedAt: new Date() },
    });

    // Fix 2: Compute attempt number from the persisted counter
    const attemptNumber = rental.depositAttemptCount + 1;

    // --- ML Deposit Verification ---
    // Confirms the deposited item matches the listing — prevents owner fraud.
    let verificationResult: any = null;
    let mlError: string | null = null; // Fix 6

    if (images && images.length > 0 && env.ML_SERVICE_URL) {
      try {
        // Fix 1: Download images as Blobs before building FormData
        const originalUrls = rental.item.images as string[];
        const [origBlobs, kioskBlobs] = await Promise.all([
          Promise.all(originalUrls.map(downloadImageAsBlob)),
          Promise.all((images as string[]).map(downloadImageAsBlob)),
        ]);
        const validOrig  = origBlobs.filter((b): b is Blob => b !== null);
        const validKiosk = kioskBlobs.filter((b): b is Blob => b !== null);

        if (validOrig.length > 0 && validKiosk.length > 0) {
          const formData = new FormData();
          validOrig.forEach( (blob, i) => formData.append('original_images', blob, `original_${i}.jpg`));
          validKiosk.forEach((blob, i) => formData.append('kiosk_images',    blob, `kiosk_${i}.jpg`));
          // Fix 2: Pass the real attempt number so ML can escalate to REJECTED on attempt 10
          formData.append('attempt_number', String(attemptNumber));
          // Fix 5: Pass cached features to skip expensive ResNet50 re-extraction
          if (rental.item.mlFeatures) {
            formData.append('reference_features', JSON.stringify(rental.item.mlFeatures));
          }

          const mlResponse = await axios.post(
            `${env.ML_SERVICE_URL}/api/v1/verify`,
            formData,
            { headers: { ...(env.ML_SERVICE_API_KEY && { 'X-API-Key': env.ML_SERVICE_API_KEY }) } }
          );
          verificationResult = mlResponse.data;
        } else {
          logger.warn(`Deposit ML skipped — no downloadable images for rental ${rentalId}`);
        }
      } catch (error) {
        // Fix 6: Capture error so admin can see why the record is in manual review
        mlError = (error as Error).message ?? 'ML service unavailable';
        logger.error('ML deposit verification failed, proceeding without it:', error);
      }
    }

    const mlDecision: string = verificationResult?.decision ?? 'PENDING';

    // --- RETRY: item does not match — release locker, owner tries again ---
    if (mlDecision === 'RETRY') {
      await prisma.locker.update({
        where: { id: lockerId },
        data: { status: 'AVAILABLE', currentRentalId: null },
      });
      // Fix 2: Persist the attempt count so next call gets the correct attempt number
      await prisma.rental.update({
        where: { id: rentalId },
        data: { depositAttemptCount: { increment: 1 } },
      });

      logger.warn(`Deposit RETRY: rental ${rentalId}, attempt ${attemptNumber}`);
      res.status(422).json({
        success: false,
        decision: 'RETRY',
        message: verificationResult?.message ?? 'Item does not match listing. Please reposition and try again.',
        confidence: verificationResult?.confidence ?? 0,
        attempt_number: attemptNumber,
      });
      return;
    }

    // --- REJECTED: permanently failed after max attempts ---
    if (mlDecision === 'REJECTED') {
      await prisma.locker.update({
        where: { id: lockerId },
        data: { status: 'AVAILABLE', currentRentalId: null },
      });
      // Fix 2: Increment counter before storing the final record
      await prisma.rental.update({
        where: { id: rentalId },
        data: { depositAttemptCount: { increment: 1 } },
      });

      const depositVerification = await prisma.verification.create({
        data: {
          originalImages: rental.item.images as any,
          kioskImages: (images || []) as any,
          decision: 'REJECTED',
          confidenceScore: verificationResult?.confidence ?? 0,
          attemptNumber,
          traditionalScore: verificationResult?.method_scores?.traditional_best,
          siftScore:        verificationResult?.method_scores?.sift_combined,
          deepLearningScore: verificationResult?.method_scores?.deep_learning_aggregated,
          ocrMatch:   verificationResult?.ocr?.match,
          ocrDetails: (verificationResult?.ocr?.details ?? {}) as any,
          status: 'REJECTED',
        },
      });

      // Cancel the rental — owner deposited the wrong item
      await prisma.rental.update({
        where: { id: rentalId },
        data: {
          status: 'CANCELLED',
          depositVerificationId: depositVerification.id,
          verificationScore: verificationResult?.confidence ?? 0,
          verificationStatus: 'REJECTED',
        },
      });

      await prisma.notification.create({
        data: {
          userId: rental.renterId,
          title: 'Rental Cancelled',
          message: `The rental for ${rental.item.title} was cancelled because the deposited item does not match the listing.`,
          type: 'VERIFICATION_FAILED',
          relatedEntityId: rentalId,
          relatedEntityType: 'rental',
        },
      });

      logger.warn(`Deposit REJECTED: rental ${rentalId}, verification ${depositVerification.id}`);
      res.status(422).json({
        success: false,
        decision: 'REJECTED',
        message: verificationResult?.message ?? 'Deposit rejected. The item does not match the listing. Rental has been cancelled.',
        confidence: verificationResult?.confidence ?? 0,
        verification: { id: depositVerification.id },
      });
      return;
    }

    // --- APPROVED or PENDING: proceed with deposit ---
    const depositVerification = await prisma.verification.create({
      data: {
        originalImages: rental.item.images as any,
        kioskImages: (images || []) as any,
        decision: mlDecision as any,
        confidenceScore: verificationResult?.confidence ?? 0,
        attemptNumber,
        traditionalScore: verificationResult?.method_scores?.traditional_best,
        siftScore:        verificationResult?.method_scores?.sift_combined,
        deepLearningScore: verificationResult?.method_scores?.deep_learning_aggregated,
        ocrMatch:   verificationResult?.ocr?.match,
        ocrDetails: (verificationResult?.ocr?.details ?? {}) as any,
        status: mlDecision === 'APPROVED' ? 'APPROVED' : 'MANUAL_REVIEW',
        // Fix 6: Explain ML failure in reviewNotes so admin has context
        ...(mlError && { reviewNotes: `ML service unavailable: ${mlError}` }),
      },
    });

    const updatedRental = await prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: 'DEPOSITED',
        depositLockerId: lockerId,
        depositedAt: new Date(),
        depositVerificationId: depositVerification.id,
        verificationScore: verificationResult?.confidence ?? 0,
        verificationStatus: mlDecision === 'APPROVED' ? 'APPROVED' : 'MANUAL_REVIEW',
      },
      include: { item: true, renter: true },
    });

    await prisma.notification.create({
      data: {
        userId: rental.renterId,
        title: 'Item Ready for Claim',
        message: `${rental.item.title} is ready for pickup at locker ${locker.lockerNumber}`,
        type: 'ITEM_READY_FOR_CLAIM',
        relatedEntityId: rentalId,
        relatedEntityType: 'rental',
      },
    });

    if (mlDecision === 'PENDING') {
      logger.warn(`Deposit requires manual review: rental ${rentalId}, confidence ${verificationResult?.confidence}`);
    }

    logger.info(`Item deposited: rental ${rentalId}, locker ${lockerId}, verification ${depositVerification.id}, decision ${mlDecision}`);

    res.json({
      success: true,
      message: mlDecision === 'PENDING'
        ? 'Item deposited. Verification requires manual admin review.'
        : 'Item deposited and verified successfully.',
      data: {
        rental: updatedRental,
        locker: { id: locker.id, lockerNumber: locker.lockerNumber },
        verification: {
          id: depositVerification.id,
          decision: depositVerification.decision,
          confidenceScore: depositVerification.confidenceScore,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const claimItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { rentalId } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true, depositLocker: true },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    if (rental.renterId !== req.user.userId) {
      throw new ForbiddenError('Only the renter can claim the item');
    }

    if (rental.status !== 'DEPOSITED') {
      throw new ValidationError('Item is not ready for claim');
    }

    if (!rental.depositLockerId) {
      throw new ValidationError('No locker assigned');
    }

    await prisma.locker.update({
      where: { id: rental.depositLockerId },
      data: { status: 'AVAILABLE', currentRentalId: null },
    });

    const updatedRental = await prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: 'ACTIVE',
        claimLockerId: rental.depositLockerId,
        claimedAt: new Date(),
      },
      include: { item: true, owner: true },
    });

    await prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: 'Item Claimed',
        message: `Your ${rental.item.title} has been claimed`,
        type: 'RENTAL_STARTED',
        relatedEntityId: rentalId,
        relatedEntityType: 'rental',
      },
    });

    logger.info(`Item claimed: rental ${rentalId}`);

    res.json({
      success: true,
      message: 'Item claimed successfully',
      data: { rental: updatedRental },
    });
  } catch (error) {
    next(error);
  }
};

export const returnItem = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    const { rentalId, lockerId, images } = req.body;

    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { item: true },
    });

    if (!rental) {
      throw new NotFoundError('Rental not found');
    }

    if (rental.renterId !== req.user.userId) {
      throw new ForbiddenError('Only the renter can return the item');
    }

    if (rental.status !== 'ACTIVE') {
      throw new ValidationError('Rental is not active');
    }

    const locker = await prisma.locker.findUnique({
      where: { id: lockerId },
    });

    if (!locker || locker.status !== 'AVAILABLE') {
      throw new ValidationError('Locker is not available');
    }

    await prisma.locker.update({
      where: { id: lockerId },
      data: { status: 'OCCUPIED', currentRentalId: rentalId, lastUsedAt: new Date() },
    });

    // Fix 2: Compute attempt number from the persisted counter
    const attemptNumber = rental.returnAttemptCount + 1;

    // --- ML Return Verification ---
    // Confirms the returned item is the same one that was rented — prevents renter fraud.
    let verificationResult: any = null;
    let mlError: string | null = null; // Fix 6

    if (images && images.length > 0 && env.ML_SERVICE_URL) {
      try {
        // Fix 1: Download images as Blobs before building FormData
        const originalUrls = rental.item.images as string[];
        const [origBlobs, kioskBlobs] = await Promise.all([
          Promise.all(originalUrls.map(downloadImageAsBlob)),
          Promise.all((images as string[]).map(downloadImageAsBlob)),
        ]);
        const validOrig  = origBlobs.filter((b): b is Blob => b !== null);
        const validKiosk = kioskBlobs.filter((b): b is Blob => b !== null);

        if (validOrig.length > 0 && validKiosk.length > 0) {
          const formData = new FormData();
          validOrig.forEach( (blob, i) => formData.append('original_images', blob, `original_${i}.jpg`));
          validKiosk.forEach((blob, i) => formData.append('kiosk_images',    blob, `kiosk_${i}.jpg`));
          // Fix 2: Pass the real attempt number
          formData.append('attempt_number', String(attemptNumber));
          // Fix 5: Pass cached features if available
          if (rental.item.mlFeatures) {
            formData.append('reference_features', JSON.stringify(rental.item.mlFeatures));
          }

          const mlResponse = await axios.post(
            `${env.ML_SERVICE_URL}/api/v1/verify`,
            formData,
            { headers: { ...(env.ML_SERVICE_API_KEY && { 'X-API-Key': env.ML_SERVICE_API_KEY }) } }
          );
          verificationResult = mlResponse.data;
        } else {
          logger.warn(`Return ML skipped — no downloadable images for rental ${rentalId}`);
        }
      } catch (error) {
        // Fix 6: Capture error for admin visibility
        mlError = (error as Error).message ?? 'ML service unavailable';
        logger.error('ML return verification failed, proceeding without it:', error);
      }
    }

    const mlDecision: string = verificationResult?.decision ?? 'PENDING';

    // Fix 4: RETRY — item does not match, release locker so renter can try again
    if (mlDecision === 'RETRY') {
      await prisma.locker.update({
        where: { id: lockerId },
        data: { status: 'AVAILABLE', currentRentalId: null },
      });
      // Fix 2: Persist attempt count
      await prisma.rental.update({
        where: { id: rentalId },
        data: { returnAttemptCount: { increment: 1 } },
      });

      logger.warn(`Return RETRY: rental ${rentalId}, attempt ${attemptNumber}`);
      res.status(422).json({
        success: false,
        decision: 'RETRY',
        message: verificationResult?.message ?? 'Item does not match. Please reposition and try again.',
        confidence: verificationResult?.confidence ?? 0,
        attempt_number: attemptNumber,
      });
      return;
    }

    // Fix 4: REJECTED — permanently failed; open dispute (do NOT cancel — renter still has item)
    if (mlDecision === 'REJECTED') {
      await prisma.locker.update({
        where: { id: lockerId },
        data: { status: 'AVAILABLE', currentRentalId: null },
      });
      // Fix 2: Increment counter
      await prisma.rental.update({
        where: { id: rentalId },
        data: { returnAttemptCount: { increment: 1 } },
      });

      const verification = await prisma.verification.create({
        data: {
          originalImages: rental.item.images as any,
          kioskImages: (images || []) as any,
          decision: 'REJECTED',
          confidenceScore: verificationResult?.confidence ?? 0,
          attemptNumber,
          traditionalScore: verificationResult?.method_scores?.traditional_best,
          // Fix 3: Use correct field names from ML response
          siftScore:        verificationResult?.method_scores?.sift_combined,
          deepLearningScore: verificationResult?.method_scores?.deep_learning_aggregated,
          ocrMatch:   verificationResult?.ocr?.match,
          ocrDetails: (verificationResult?.ocr?.details ?? {}) as any,
          status: 'REJECTED',
        },
      });

      // Move to DISPUTED — renter has the item, admin must investigate
      await prisma.rental.update({
        where: { id: rentalId },
        data: {
          status: 'DISPUTED',
          returnLockerId: lockerId,
          returnedAt: new Date(),
          actualReturnDate: new Date(),
          verificationId: verification.id,
          verificationScore: verificationResult?.confidence ?? 0,
          verificationStatus: 'REJECTED',
        },
      });

      await prisma.notification.create({
        data: {
          userId: rental.ownerId,
          title: 'Return Disputed',
          message: `The returned item for ${rental.item.title} did not match verification. An admin will review.`,
          type: 'VERIFICATION_FAILED',
          relatedEntityId: rentalId,
          relatedEntityType: 'rental',
        },
      });

      logger.warn(`Return REJECTED: rental ${rentalId}, verification ${verification.id}`);
      res.status(422).json({
        success: false,
        decision: 'REJECTED',
        message: verificationResult?.message ?? 'Return rejected. Item does not match. A dispute has been opened.',
        confidence: verificationResult?.confidence ?? 0,
        verification: { id: verification.id },
      });
      return;
    }

    // --- APPROVED or PENDING: create verification record and advance rental ---
    const verification = await prisma.verification.create({
      data: {
        originalImages: rental.item.images as any,
        kioskImages: (images || []) as any,
        decision: mlDecision as any,
        confidenceScore: verificationResult?.confidence ?? 0,
        attemptNumber,
        traditionalScore: verificationResult?.method_scores?.traditional_best,
        // Fix 3: Correct field names
        siftScore:        verificationResult?.method_scores?.sift_combined,
        deepLearningScore: verificationResult?.method_scores?.deep_learning_aggregated,
        ocrMatch:   verificationResult?.ocr?.match,
        ocrDetails: (verificationResult?.ocr?.details ?? {}) as any,
        status: mlDecision === 'APPROVED' ? 'APPROVED' : 'MANUAL_REVIEW',
        // Fix 6: Explain ML failure in reviewNotes
        ...(mlError && { reviewNotes: `ML service unavailable: ${mlError}` }),
      },
    });

    const updatedRental = await prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: 'VERIFICATION',
        returnLockerId: lockerId,
        returnedAt: new Date(),
        actualReturnDate: new Date(),
        verificationId: verification.id,
        verificationScore: verificationResult?.confidence ?? 0,
        verificationStatus: mlDecision === 'APPROVED' ? 'APPROVED' : 'MANUAL_REVIEW',
      },
      include: { item: true, owner: true, verification: true },
    });

    await prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: 'Item Returned',
        message: `${rental.item.title} has been returned and is under verification`,
        type: 'RETURN_REMINDER',
        relatedEntityId: rentalId,
        relatedEntityType: 'rental',
      },
    });

    if (mlDecision === 'PENDING') {
      logger.warn(`Return requires manual review: rental ${rentalId}, confidence ${verificationResult?.confidence}`);
    }

    logger.info(`Item returned: rental ${rentalId}, verification ${verification.id}, decision ${mlDecision}`);

    res.json({
      success: true,
      message: 'Item returned successfully. Verification in progress.',
      data: {
        rental: updatedRental,
        verification: {
          id: verification.id,
          decision: verification.decision,
          confidenceScore: verification.confidenceScore,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getAvailableLockers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { kioskId, size } = req.query;

    const where: any = {
      status: 'AVAILABLE',
      isOperational: true,
    };

    if (kioskId) where.kioskId = kioskId;
    if (size) where.size = size;

    const lockers = await prisma.locker.findMany({
      where,
      orderBy: { lockerNumber: 'asc' },
    });

    res.json({
      success: true,
      data: { lockers },
    });
  } catch (error) {
    next(error);
  }
};
