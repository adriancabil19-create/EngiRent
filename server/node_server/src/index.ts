import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import axios from "axios";
import env from "./config/env";
import { connectDatabase } from "./config/database";
import logger from "./utils/logger";
import routes from "./routes";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { rateLimiter } from "./middleware/rateLimiter";
import prisma from "./config/database";
import kioskEventBus from "./utils/kioskEventBus";

const app: Application = express();
const httpServer = createServer(app);

const ALLOWED_ORIGINS = [
  env.CLIENT_WEB_URL,
  env.CLIENT_MOBILE_URL,
  env.CLIENT_ADMIN_URL,
];

const io = new SocketServer(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));
// Admin routes are protected by JWT + requireAdmin — skip rate limiter for them
app.use((req, res, next) => {
  if (req.path.startsWith(`/api/${env.API_VERSION}/admin`)) return next();
  return rateLimiter(req, res, next);
});

// Expose io to controllers
app.set("io", io);

// ── API routes ─────────────────────────────────────────────────────────────
app.use(`/api/${env.API_VERSION}`, routes);

// ── Error handling ─────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── ML verification helper (shared by deposit/return socket flows) ──────────
async function downloadBlob(url: string): Promise<Blob | null> {
  try {
    const r = await axios.get(url, { responseType: "arraybuffer" });
    return new Blob([r.data as ArrayBuffer], { type: "image/jpeg" });
  } catch {
    logger.warn(`Could not download image: ${url}`);
    return null;
  }
}

async function runMlVerification(
  originalUrls: string[],
  kioskUrls: string[],
  attemptNumber: number,
  mlFeatures: unknown,
): Promise<{
  decision: string;
  confidence: number;
  method_scores: Record<string, number>;
  ocr: unknown;
}> {
  const [origBlobs, kioskBlobs] = await Promise.all([
    Promise.all(originalUrls.map(downloadBlob)),
    Promise.all(kioskUrls.map(downloadBlob)),
  ]);

  const validOrig = origBlobs.filter((b): b is Blob => b !== null);
  const validKiosk = kioskBlobs.filter((b): b is Blob => b !== null);

  if (validOrig.length === 0 || validKiosk.length === 0) {
    return { decision: "PENDING", confidence: 0, method_scores: {}, ocr: null };
  }

  const formData = new FormData();
  validOrig.forEach((b, i) =>
    formData.append("original_images", b, `original_${i}.jpg`),
  );
  validKiosk.forEach((b, i) =>
    formData.append("kiosk_images", b, `kiosk_${i}.jpg`),
  );
  formData.append("attempt_number", String(attemptNumber));
  if (mlFeatures)
    formData.append("reference_features", JSON.stringify(mlFeatures));

  const resp = await axios.post(
    `${env.ML_SERVICE_URL}/api/v1/verify`,
    formData,
    {
      headers: {
        ...(env.ML_SERVICE_API_KEY && { "X-API-Key": env.ML_SERVICE_API_KEY }),
      },
    },
  );

  return resp.data as {
    decision: string;
    confidence: number;
    method_scores: Record<string, number>;
    ocr: unknown;
  };
}

// ── Auto-complete a rental after successful verifications ────────────────────
async function completeRental(rentalId: string): Promise<void> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: { item: true },
  });
  if (!rental) return;

  await prisma.$transaction([
    prisma.rental.update({
      where: { id: rentalId },
      data: { status: "COMPLETED", completedAt: new Date() },
    }),
    prisma.item.update({
      where: { id: rental.itemId },
      data: { isAvailable: true, totalRentals: { increment: 1 } },
    }),
    prisma.notification.create({
      data: {
        userId: rental.renterId,
        title: "Rental Completed",
        message: `Your rental of ${rental.item.title} is complete. Security deposit refund is being processed.`,
        type: "VERIFICATION_SUCCESS",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    }),
    prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: "Item Returned & Verified",
        message: `${rental.item.title} has been returned and verified. Rental payment will be released.`,
        type: "VERIFICATION_SUCCESS",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    }),
  ]);

  // Notify both parties via socket
  io.to(`user:${rental.renterId}`).emit("rental:completed", { rentalId });
  io.to(`user:${rental.ownerId}`).emit("rental:completed", { rentalId });
}

// ── Socket.io ─────────────────────────────────────────────────────────────
io.on("connection", (socket: Socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // ── User room join (mobile app / admin console)
  socket.on("join", (userId: string) => {
    socket.join(`user:${userId}`);
    logger.info(`User ${userId} joined their notification room`);
  });

  // ── Kiosk registration — Pi announces itself on connect
  socket.on(
    "kiosk:register",
    async (data: {
      kiosk_id: string;
      locker_count: number;
      version: string;
    }) => {
      const { kiosk_id, locker_count, version } = data;
      socket.join(`kiosk:${kiosk_id}`);

      logger.info(
        `\n┌─────────────────────────────────────────────\n` +
        `│  🟢 [PI-ONLINE]  Kiosk registered\n` +
        `│  Kiosk ID : ${kiosk_id}\n` +
        `│  Socket   : ${socket.id}\n` +
        `│  Lockers  : ${locker_count ?? "?"}\n` +
        `│  Version  : ${version ?? "?"}\n` +
        `└─────────────────────────────────────────────`
      );

      // Push stored config to Pi immediately
      try {
        const record = await prisma.kioskConfig.findUnique({
          where: { kioskId: kiosk_id },
        });
        if (record?.config) {
          socket.emit("kiosk:config", record.config);
          logger.info(`  📤 [PI-CONFIG]  Pushed stored config to ${kiosk_id}`);
        }
      } catch (err) {
        logger.error(`Failed to push config to kiosk ${kiosk_id}:`, err);
      }

      // Broadcast online status to admin
      io.emit("admin:kiosk_online", { kiosk_id, socket_id: socket.id });
      kioskEventBus.emit("kiosk_online", { kiosk_id, socket_id: socket.id, ts: Date.now() });
    },
  );

  // ── Kiosk ACK — Pi confirms it received and executed a command
  socket.on(
    "kiosk:ack",
    (data: {
      kiosk_id: string;
      command_id: string;
      action: string;
      status: "ok" | "error";
      message?: string;
    }) => {
      const { kiosk_id, command_id, action, status, message } = data;
      if (status === "ok") {
        logger.info(
          `\n┌─────────────────────────────────────────────\n` +
          `│  ✅ [PI-ACK]  Command confirmed by Pi\n` +
          `│  Kiosk     : ${kiosk_id}\n` +
          `│  Command ID: ${command_id}\n` +
          `│  Action    : ${action}\n` +
          `│  Status    : OK\n` +
          `└─────────────────────────────────────────────`
        );
      } else {
        logger.warn(
          `\n┌─────────────────────────────────────────────\n` +
          `│  ⚠️  [PI-ACK]  Command FAILED on Pi\n` +
          `│  Kiosk     : ${kiosk_id}\n` +
          `│  Command ID: ${command_id}\n` +
          `│  Action    : ${action}\n` +
          `│  Error     : ${message ?? "unknown"}\n` +
          `└─────────────────────────────────────────────`
        );
      }
      io.emit("admin:kiosk_ack", data);
      kioskEventBus.emit("kiosk_ack", { ...data, ts: Date.now() });
    },
  );

  // ── Kiosk status update
  socket.on("kiosk:status", (data: unknown) => {
    const d = data as Record<string, unknown>;
    const ui   = d?.ui_state as Record<string, unknown> | undefined;
    const lockers = ui?.lockers as Record<string, Record<string, string>> | undefined;
    const lockerSummary = lockers
      ? Object.entries(lockers)
          .map(([id, doors]) =>
            `L${id}[main:${doors.main ?? "?"}|bottom:${doors.bottom ?? "?"}]`
          )
          .join("  ")
      : "?";
    logger.info(
      `\n┌─────────────────────────────────────────────\n` +
      `│  📡 [PI-STATUS]  Kiosk state update\n` +
      `│  Kiosk   : ${d?.kiosk_id ?? "?"}\n` +
      `│  UI      : ${ui?.status ?? "?"} — ${ui?.message ?? ""}\n` +
      `│  Lockers : ${lockerSummary}\n` +
      `└─────────────────────────────────────────────`
    );
    io.emit("admin:kiosk_status", data);
    kioskEventBus.emit("kiosk_status", { ...d, ts: Date.now() });
  });

  // ── Kiosk images — Pi finished capturing, URLs come back here
  // Bridge: run ML verification and advance the rental
  socket.on(
    "kiosk:images",
    async (data: {
      kiosk_id: string;
      locker_id: number;
      image_urls: string[];
      rental_id?: string;
    }) => {
      const { rental_id, image_urls, locker_id } = data;

      if (!rental_id) {
        logger.warn("kiosk:images received without rental_id — ignoring");
        return;
      }

      logger.info(
        `\n┌─────────────────────────────────────────────\n` +
        `│  📸 [PI-IMAGES]  Kiosk sent captured images\n` +
        `│  Kiosk    : ${data.kiosk_id}\n` +
        `│  Rental   : ${rental_id}\n` +
        `│  Locker   : ${locker_id}\n` +
        `│  Images   : ${image_urls.length} file(s)\n` +
        `└─────────────────────────────────────────────`
      );

      try {
        const rental = await prisma.rental.findUnique({
          where: { id: rental_id },
          include: { item: true },
        });

        if (!rental) {
          logger.warn(`kiosk:images — rental ${rental_id} not found`);
          return;
        }

        // ── DEPOSIT flow ─────────────────────────────────────────────────
        if (rental.status === "AWAITING_DEPOSIT") {
          const lockerId = String(locker_id);
          const locker = await prisma.locker.findFirst({
            where: { lockerNumber: lockerId },
          });

          const attemptNumber = rental.depositAttemptCount + 1;
          let mlResult: Awaited<ReturnType<typeof runMlVerification>>;
          let mlError: string | null = null;

          try {
            mlResult = await runMlVerification(
              rental.item.images as string[],
              image_urls,
              attemptNumber,
              rental.item.mlFeatures,
            );
          } catch (err) {
            mlError = (err as Error).message;
            mlResult = {
              decision: "PENDING",
              confidence: 0,
              method_scores: {},
              ocr: null,
            };
          }

          const { decision, confidence, method_scores } = mlResult;

          if (decision === "RETRY") {
            await prisma.rental.update({
              where: { id: rental_id },
              data: { depositAttemptCount: { increment: 1 } },
            });
            socket.emit("kiosk:command", {
              action: "open_door",
              locker_id,
              door: "main_door",
            });
            io.to(`user:${rental.ownerId}`).emit("deposit:retry", {
              rentalId: rental_id,
              attemptNumber,
              confidence,
            });
            return;
          }

          if (decision === "REJECTED") {
            await prisma.rental.update({
              where: { id: rental_id },
              data: { depositAttemptCount: { increment: 1 } },
            });
            const verification = await prisma.verification.create({
              data: {
                originalImages: rental.item.images as never,
                kioskImages: image_urls as never,
                decision: "REJECTED",
                confidenceScore: confidence,
                attemptNumber,
                traditionalScore: method_scores?.traditional_best,
                siftScore: method_scores?.sift_combined,
                deepLearningScore: method_scores?.deep_learning_aggregated,
                status: "REJECTED",
              },
            });
            await prisma.rental.update({
              where: { id: rental_id },
              data: {
                status: "CANCELLED",
                depositVerificationId: verification.id,
                verificationScore: confidence,
                verificationStatus: "REJECTED",
              },
            });
            if (locker) {
              await prisma.locker.update({
                where: { id: locker.id },
                data: { status: "AVAILABLE", currentRentalId: null },
              });
            }
            await prisma.notification.create({
              data: {
                userId: rental.renterId,
                title: "Rental Cancelled",
                message: `Deposit for ${rental.item.title} was rejected after ${attemptNumber} attempts.`,
                type: "VERIFICATION_FAILED",
                relatedEntityId: rental_id,
                relatedEntityType: "rental",
              },
            });
            io.to(`user:${rental.ownerId}`).emit("deposit:rejected", {
              rentalId: rental_id,
            });
            io.to(`user:${rental.renterId}`).emit("deposit:rejected", {
              rentalId: rental_id,
            });
            return;
          }

          // APPROVED or PENDING — proceed with deposit
          const verification = await prisma.verification.create({
            data: {
              originalImages: rental.item.images as never,
              kioskImages: image_urls as never,
              decision: decision as never,
              confidenceScore: confidence,
              attemptNumber,
              traditionalScore: method_scores?.traditional_best,
              siftScore: method_scores?.sift_combined,
              deepLearningScore: method_scores?.deep_learning_aggregated,
              status: decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW",
              ...(mlError && { reviewNotes: `ML error: ${mlError}` }),
            },
          });

          await prisma.rental.update({
            where: { id: rental_id },
            data: {
              status: "DEPOSITED",
              ...(locker && { depositLockerId: locker.id }),
              depositedAt: new Date(),
              depositVerificationId: verification.id,
              verificationScore: confidence,
              verificationStatus:
                decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW",
            },
          });

          if (locker) {
            await prisma.locker.update({
              where: { id: locker.id },
              data: {
                status: "OCCUPIED",
                currentRentalId: rental_id,
                lastUsedAt: new Date(),
              },
            });
          }

          await prisma.notification.create({
            data: {
              userId: rental.renterId,
              title: "Item Ready for Claim",
              message: `${rental.item.title} has been deposited and is ready for pickup.`,
              type: "ITEM_READY_FOR_CLAIM",
              relatedEntityId: rental_id,
              relatedEntityType: "rental",
            },
          });

          io.to(`user:${rental.renterId}`).emit("deposit:approved", {
            rentalId: rental_id,
            decision,
            confidence,
          });
          io.to(`user:${rental.ownerId}`).emit("deposit:approved", {
            rentalId: rental_id,
            decision,
            confidence,
          });
          logger.info(`Deposit ${decision} for rental ${rental_id}`);
        }

        // ── RETURN flow ──────────────────────────────────────────────────
        else if (rental.status === "ACTIVE") {
          const lockerId = String(locker_id);
          const locker = await prisma.locker.findFirst({
            where: { lockerNumber: lockerId },
          });

          const attemptNumber = rental.returnAttemptCount + 1;
          let mlResult: Awaited<ReturnType<typeof runMlVerification>>;
          let mlError: string | null = null;

          try {
            mlResult = await runMlVerification(
              rental.item.images as string[],
              image_urls,
              attemptNumber,
              rental.item.mlFeatures,
            );
          } catch (err) {
            mlError = (err as Error).message;
            mlResult = {
              decision: "PENDING",
              confidence: 0,
              method_scores: {},
              ocr: null,
            };
          }

          const { decision, confidence, method_scores } = mlResult;

          if (decision === "RETRY") {
            await prisma.rental.update({
              where: { id: rental_id },
              data: { returnAttemptCount: { increment: 1 } },
            });
            socket.emit("kiosk:command", {
              action: "open_door",
              locker_id,
              door: "main_door",
            });
            io.to(`user:${rental.renterId}`).emit("return:retry", {
              rentalId: rental_id,
              attemptNumber,
              confidence,
            });
            return;
          }

          if (decision === "REJECTED") {
            await prisma.rental.update({
              where: { id: rental_id },
              data: { returnAttemptCount: { increment: 1 } },
            });
            const verification = await prisma.verification.create({
              data: {
                originalImages: rental.item.images as never,
                kioskImages: image_urls as never,
                decision: "REJECTED",
                confidenceScore: confidence,
                attemptNumber,
                traditionalScore: method_scores?.traditional_best,
                siftScore: method_scores?.sift_combined,
                deepLearningScore: method_scores?.deep_learning_aggregated,
                status: "REJECTED",
              },
            });
            await prisma.rental.update({
              where: { id: rental_id },
              data: {
                status: "DISPUTED",
                verificationId: verification.id,
                verificationScore: confidence,
                verificationStatus: "REJECTED",
                returnedAt: new Date(),
                actualReturnDate: new Date(),
              },
            });
            if (locker) {
              await prisma.locker.update({
                where: { id: locker.id },
                data: { status: "AVAILABLE", currentRentalId: null },
              });
            }
            await prisma.notification.create({
              data: {
                userId: rental.ownerId,
                title: "Return Disputed",
                message: `Returned item for ${rental.item.title} did not match verification. Admin will review.`,
                type: "VERIFICATION_FAILED",
                relatedEntityId: rental_id,
                relatedEntityType: "rental",
              },
            });
            io.to(`user:${rental.renterId}`).emit("return:disputed", {
              rentalId: rental_id,
            });
            io.to(`user:${rental.ownerId}`).emit("return:disputed", {
              rentalId: rental_id,
            });
            return;
          }

          // APPROVED or PENDING
          const verification = await prisma.verification.create({
            data: {
              originalImages: rental.item.images as never,
              kioskImages: image_urls as never,
              decision: decision as never,
              confidenceScore: confidence,
              attemptNumber,
              traditionalScore: method_scores?.traditional_best,
              siftScore: method_scores?.sift_combined,
              deepLearningScore: method_scores?.deep_learning_aggregated,
              status: decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW",
              ...(mlError && { reviewNotes: `ML error: ${mlError}` }),
            },
          });

          const verificationStatus =
            decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW";

          await prisma.rental.update({
            where: { id: rental_id },
            data: {
              status: "VERIFICATION",
              ...(locker && { returnLockerId: locker.id }),
              returnedAt: new Date(),
              actualReturnDate: new Date(),
              verificationId: verification.id,
              verificationScore: confidence,
              verificationStatus,
            },
          });

          if (locker) {
            await prisma.locker.update({
              where: { id: locker.id },
              data: {
                status: "OCCUPIED",
                currentRentalId: rental_id,
                lastUsedAt: new Date(),
              },
            });
          }

          if (decision === "APPROVED") {
            await completeRental(rental_id);
          } else {
            // PENDING — notify admin for manual review
            await prisma.notification.create({
              data: {
                userId: rental.ownerId,
                title: "Item Returned — Under Review",
                message: `${rental.item.title} return requires manual verification (confidence: ${confidence.toFixed(1)}%).`,
                type: "RETURN_REMINDER",
                relatedEntityId: rental_id,
                relatedEntityType: "rental",
              },
            });
            io.to(`user:${rental.renterId}`).emit("return:under_review", {
              rentalId: rental_id,
              confidence,
            });
          }

          logger.info(`Return ${decision} for rental ${rental_id}`);
        } else {
          logger.warn(
            `kiosk:images for rental ${rental_id} in unexpected status: ${rental.status}`,
          );
        }
      } catch (err) {
        logger.error(
          `kiosk:images handler error for rental ${rental_id}:`,
          err,
        );
      }
    },
  );

  // ── Kiosk face result — Pi sends after capture_face command
  // Gate: if verified → open main door + advance rental to ACTIVE
  socket.on(
    "kiosk:face",
    async (data: {
      kiosk_id: string;
      rental_id?: string;
      user_id?: string;
      detected: boolean;
      verified: boolean;
      confidence: number;
      face_url?: string;
    }) => {
      const { rental_id, user_id, detected, verified, confidence } = data;

      logger.info(
        `\n┌─────────────────────────────────────────────\n` +
        `│  👤 [PI-FACE]  Face verification result\n` +
        `│  Kiosk      : ${data.kiosk_id}\n` +
        `│  Rental     : ${rental_id}\n` +
        `│  User       : ${user_id ?? "?"}\n` +
        `│  Detected   : ${detected}\n` +
        `│  Verified   : ${verified}\n` +
        `│  Confidence : ${(confidence * 100).toFixed(1)}%\n` +
        `└─────────────────────────────────────────────`
      );

      if (!rental_id) return;

      try {
        const rental = await prisma.rental.findUnique({
          where: { id: rental_id },
          include: { item: true },
        });
        if (!rental) return;

        if (!verified) {
          io.to(`user:${rental.renterId}`).emit("face:failed", {
            rentalId: rental_id,
            confidence,
          });
          return;
        }

        // ── Claim: advance DEPOSITED → ACTIVE
        if (rental.status === "DEPOSITED") {
          await prisma.rental.update({
            where: { id: rental_id },
            data: { status: "ACTIVE", claimedAt: new Date() },
          });

          // Open the locker door for the renter
          socket.emit("kiosk:command", {
            action: "open_door",
            locker_id: rental.depositLockerId,
            door: "main_door",
          });

          if (rental.depositLockerId) {
            await prisma.locker.update({
              where: { id: rental.depositLockerId },
              data: { status: "AVAILABLE", currentRentalId: null },
            });
          }

          await prisma.notification.create({
            data: {
              userId: rental.ownerId,
              title: "Item Claimed",
              message: `Your ${rental.item.title} has been claimed by the renter.`,
              type: "RENTAL_STARTED",
              relatedEntityId: rental_id,
              relatedEntityType: "rental",
            },
          });

          io.to(`user:${rental.renterId}`).emit("face:verified", {
            rentalId: rental_id,
            action: "claim",
          });
          io.to(`user:${rental.ownerId}`).emit("rental:active", {
            rentalId: rental_id,
          });
          logger.info(`Claim approved for rental ${rental_id}`);
        }

        // ── Return: face verified, now request image capture
        else if (rental.status === "ACTIVE") {
          const returnLockerId = rental.returnLockerId ?? rental.depositLockerId;
          socket.emit("kiosk:command", {
            action: "capture_image",
            locker_id: returnLockerId,
            num_frames: 3,
            rental_id,
          });
          io.to(`user:${rental.renterId}`).emit("face:verified", {
            rentalId: rental_id,
            action: "return",
          });
        }
      } catch (err) {
        logger.error(`kiosk:face handler error for rental ${rental_id}:`, err);
      }
    },
  );

  // ── Kiosk error passthrough
  socket.on("kiosk:error", (data: unknown) => {
    const d = data as Record<string, unknown>;
    logger.warn(
      `\n┌─────────────────────────────────────────────\n` +
      `│  ❌ [PI-ERROR]  Kiosk reported an error\n` +
      `│  Kiosk  : ${d?.kiosk_id ?? "?"}\n` +
      `│  Error  : ${d?.message ?? JSON.stringify(data)}\n` +
      `└─────────────────────────────────────────────`
    );
    io.emit("admin:kiosk_error", data);
    kioskEventBus.emit("kiosk_error", { ...d, ts: Date.now() });
  });

  // ── Pi log forwarding — all relevant Pi logs streamed to Render
  socket.on(
    "kiosk:log",
    (data: {
      kiosk_id: string;
      level: string;
      module: string;
      message: string;
      ts: number;
    }) => {
      const { kiosk_id, level, module, message } = data;
      const tag = level === "WARNING" || level === "ERROR" || level === "CRITICAL"
        ? `⚠️  [PI-${level}]`
        : `📟 [PI-LOG]`;
      const line = `${tag}  ${kiosk_id} | ${level.padEnd(8)} | ${module.padEnd(20)} | ${message}`;
      if (level === "ERROR" || level === "CRITICAL") {
        logger.error(line);
      } else if (level === "WARNING") {
        logger.warn(line);
      } else {
        logger.info(line);
      }
      kioskEventBus.emit("kiosk_log", { ...data, ts: Date.now() });
    },
  );

  socket.on("disconnect", () => {
    logger.info(
      `\n┌─────────────────────────────────────────────\n` +
      `│  🔴 [PI-OFFLINE]  Kiosk disconnected\n` +
      `│  Socket : ${socket.id}\n` +
      `└─────────────────────────────────────────────`
    );
    kioskEventBus.emit("kiosk_offline", { socket_id: socket.id, ts: Date.now() });
  });
});

// ── Server startup ─────────────────────────────────────────────────────────
const PORT = parseInt(env.PORT);

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();

    httpServer.listen(PORT, "0.0.0.0", () => {
      logger.info(`
╔════════════════════════════════════════════╗
║   🚀 EngiRent Hub API Server Started      ║
║   Port: ${PORT}  |  Env: ${env.NODE_ENV.padEnd(12)}      ║
║   API: http://localhost:${PORT}/api/${env.API_VERSION}     ║
╚════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — closing server");
  httpServer.close(() => logger.info("HTTP server closed"));
});

startServer();

export { app, io };
