-- ============================================================
--  EngiRent Hub — MySQL Database Schema
--  MySQL 8.0+  |  charset utf8mb4
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ─── users ───────────────────────────────────────────────────

CREATE TABLE `users` (
  `id`              VARCHAR(36)  NOT NULL,
  `email`           VARCHAR(191) NOT NULL,
  `password`        VARCHAR(191) NOT NULL,
  `studentId`       VARCHAR(191) NOT NULL,
  `firstName`       VARCHAR(191) NOT NULL,
  `lastName`        VARCHAR(191) NOT NULL,
  `phoneNumber`     VARCHAR(191) NOT NULL,
  `profileImage`    VARCHAR(191)     NULL,
  `parentName`      VARCHAR(191)     NULL,
  `parentContact`   VARCHAR(191)     NULL,
  `isVerified`      TINYINT(1)   NOT NULL DEFAULT 0,
  `isActive`        TINYINT(1)   NOT NULL DEFAULT 1,
  `emailVerifiedAt` DATETIME(3)      NULL,
  `refreshToken`    TEXT             NULL,
  `lastLogin`       DATETIME(3)      NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_key`     (`email`),
  UNIQUE KEY `users_studentId_key` (`studentId`),
  INDEX `users_email_idx`     (`email`),
  INDEX `users_studentId_idx` (`studentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── items ───────────────────────────────────────────────────

CREATE TABLE `items` (
  `id`              VARCHAR(36)  NOT NULL,
  `ownerId`         VARCHAR(36)  NOT NULL,
  `title`           VARCHAR(191) NOT NULL,
  `description`     TEXT         NOT NULL,
  `category`        ENUM('SCHOOL_ATTIRE','ACADEMIC_TOOLS','ELECTRONICS','DEVELOPMENT_KITS',
                         'MEASUREMENT_TOOLS','AUDIO_VISUAL','SPORTS_EQUIPMENT','OTHER') NOT NULL,
  `condition`       ENUM('NEW','LIKE_NEW','GOOD','FAIR','ACCEPTABLE') NOT NULL,
  `pricePerDay`     DOUBLE       NOT NULL,
  `pricePerWeek`    DOUBLE           NULL,
  `pricePerMonth`   DOUBLE           NULL,
  `securityDeposit` DOUBLE       NOT NULL,
  `images`          JSON         NOT NULL,
  `mlFeatures`      JSON             NULL,
  `serialNumber`    VARCHAR(191)     NULL,
  `isAvailable`     TINYINT(1)   NOT NULL DEFAULT 1,
  `isActive`        TINYINT(1)   NOT NULL DEFAULT 1,
  `campusLocation`  VARCHAR(191)     NULL,
  `totalRentals`    INT          NOT NULL DEFAULT 0,
  `averageRating`   DOUBLE       NOT NULL DEFAULT 0,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `items_ownerId_idx`     (`ownerId`),
  INDEX `items_category_idx`    (`category`),
  INDEX `items_isAvailable_idx` (`isAvailable`),
  CONSTRAINT `items_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── lockers ─────────────────────────────────────────────────

CREATE TABLE `lockers` (
  `id`             VARCHAR(36)  NOT NULL,
  `lockerNumber`   VARCHAR(191) NOT NULL,
  `kioskId`        VARCHAR(191) NOT NULL,
  `size`           ENUM('SMALL','MEDIUM','LARGE','EXTRA_LARGE') NOT NULL DEFAULT 'MEDIUM',
  `status`         ENUM('AVAILABLE','OCCUPIED','RESERVED','MAINTENANCE','OUT_OF_SERVICE') NOT NULL DEFAULT 'AVAILABLE',
  `isOperational`  TINYINT(1)   NOT NULL DEFAULT 1,
  `currentRentalId` VARCHAR(36)     NULL,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `lastUsedAt`     DATETIME(3)      NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `lockers_lockerNumber_key` (`lockerNumber`),
  INDEX `lockers_kioskId_idx` (`kioskId`),
  INDEX `lockers_status_idx`  (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── verifications ───────────────────────────────────────────

CREATE TABLE `verifications` (
  `id`                VARCHAR(36)  NOT NULL,
  `originalImages`    JSON         NOT NULL,
  `kioskImages`       JSON         NOT NULL,
  `decision`          ENUM('APPROVED','PENDING','RETRY','REJECTED') NOT NULL,
  `confidenceScore`   DOUBLE       NOT NULL,
  `attemptNumber`     INT          NOT NULL DEFAULT 1,
  `traditionalScore`  DOUBLE           NULL,
  `siftScore`         DOUBLE           NULL,
  `deepLearningScore` DOUBLE           NULL,
  `ocrMatch`          TINYINT(1)       NULL,
  `ocrDetails`        JSON             NULL,
  `status`            ENUM('PENDING','PROCESSING','COMPLETED','MANUAL_REVIEW','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `reviewedBy`        VARCHAR(191)     NULL,
  `reviewNotes`       TEXT             NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `verifications_decision_idx` (`decision`),
  INDEX `verifications_status_idx`   (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── rentals ─────────────────────────────────────────────────

CREATE TABLE `rentals` (
  `id`                    VARCHAR(36)  NOT NULL,
  `itemId`                VARCHAR(36)  NOT NULL,
  `renterId`              VARCHAR(36)  NOT NULL,
  `ownerId`               VARCHAR(36)  NOT NULL,
  `startDate`             DATETIME(3)  NOT NULL,
  `endDate`               DATETIME(3)  NOT NULL,
  `actualReturnDate`      DATETIME(3)      NULL,
  `status`                ENUM('PENDING','AWAITING_DEPOSIT','DEPOSITED','AWAITING_CLAIM',
                               'ACTIVE','AWAITING_RETURN','VERIFICATION','COMPLETED',
                               'CANCELLED','DISPUTED') NOT NULL DEFAULT 'PENDING',
  `totalPrice`            DOUBLE       NOT NULL,
  `securityDeposit`       DOUBLE       NOT NULL,
  `depositLockerId`       VARCHAR(36)      NULL,
  `claimLockerId`         VARCHAR(36)      NULL,
  `returnLockerId`        VARCHAR(36)      NULL,
  `depositVerificationId` VARCHAR(36)      NULL,
  `verificationId`        VARCHAR(36)      NULL,
  `verificationScore`     DOUBLE           NULL,
  `verificationStatus`    ENUM('PENDING','PROCESSING','COMPLETED','MANUAL_REVIEW','APPROVED','REJECTED') NULL,
  `depositAttemptCount`   INT          NOT NULL DEFAULT 0,
  `returnAttemptCount`    INT          NOT NULL DEFAULT 0,
  `createdAt`             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `depositedAt`           DATETIME(3)      NULL,
  `claimedAt`             DATETIME(3)      NULL,
  `returnedAt`            DATETIME(3)      NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rentals_depositVerificationId_key` (`depositVerificationId`),
  UNIQUE KEY `rentals_verificationId_key`        (`verificationId`),
  INDEX `rentals_itemId_idx`   (`itemId`),
  INDEX `rentals_renterId_idx` (`renterId`),
  INDEX `rentals_ownerId_idx`  (`ownerId`),
  INDEX `rentals_status_idx`   (`status`),
  CONSTRAINT `rentals_itemId_fkey`
    FOREIGN KEY (`itemId`)    REFERENCES `items`         (`id`) ON DELETE CASCADE,
  CONSTRAINT `rentals_renterId_fkey`
    FOREIGN KEY (`renterId`)  REFERENCES `users`         (`id`),
  CONSTRAINT `rentals_ownerId_fkey`
    FOREIGN KEY (`ownerId`)   REFERENCES `users`         (`id`),
  CONSTRAINT `rentals_depositLockerId_fkey`
    FOREIGN KEY (`depositLockerId`)      REFERENCES `lockers`       (`id`) ON DELETE SET NULL,
  CONSTRAINT `rentals_claimLockerId_fkey`
    FOREIGN KEY (`claimLockerId`)        REFERENCES `lockers`       (`id`) ON DELETE SET NULL,
  CONSTRAINT `rentals_returnLockerId_fkey`
    FOREIGN KEY (`returnLockerId`)       REFERENCES `lockers`       (`id`) ON DELETE SET NULL,
  CONSTRAINT `rentals_depositVerificationId_fkey`
    FOREIGN KEY (`depositVerificationId`) REFERENCES `verifications` (`id`) ON DELETE SET NULL,
  CONSTRAINT `rentals_verificationId_fkey`
    FOREIGN KEY (`verificationId`)       REFERENCES `verifications` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── transactions ─────────────────────────────────────────────

CREATE TABLE `transactions` (
  `id`                  VARCHAR(36)  NOT NULL,
  `rentalId`            VARCHAR(36)  NOT NULL,
  `userId`              VARCHAR(36)  NOT NULL,
  `type`                ENUM('RENTAL_PAYMENT','SECURITY_DEPOSIT','DEPOSIT_REFUND','LATE_FEE','DAMAGE_FEE') NOT NULL,
  `amount`              DOUBLE       NOT NULL,
  `status`              ENUM('PENDING','PROCESSING','COMPLETED','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  `gcashReferenceNo`    VARCHAR(191)     NULL,
  `gcashTransactionId`  VARCHAR(191)     NULL,
  `paymentMethod`       VARCHAR(191) NOT NULL DEFAULT 'GCash',
  `paymentDetails`      JSON             NULL,
  `createdAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `paidAt`              DATETIME(3)      NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transactions_gcashReferenceNo_key`   (`gcashReferenceNo`),
  UNIQUE KEY `transactions_gcashTransactionId_key` (`gcashTransactionId`),
  INDEX `transactions_rentalId_idx`         (`rentalId`),
  INDEX `transactions_userId_idx`           (`userId`),
  INDEX `transactions_gcashReferenceNo_idx` (`gcashReferenceNo`),
  CONSTRAINT `transactions_rentalId_fkey`
    FOREIGN KEY (`rentalId`) REFERENCES `rentals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `transactions_userId_fkey`
    FOREIGN KEY (`userId`)   REFERENCES `users`   (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── notifications ────────────────────────────────────────────

CREATE TABLE `notifications` (
  `id`                VARCHAR(36)  NOT NULL,
  `userId`            VARCHAR(36)  NOT NULL,
  `title`             VARCHAR(191) NOT NULL,
  `message`           TEXT         NOT NULL,
  `type`              ENUM('BOOKING_CONFIRMED','DEPOSIT_REMINDER','ITEM_READY_FOR_CLAIM',
                           'CLAIM_REMINDER','RENTAL_STARTED','RETURN_REMINDER','RETURN_OVERDUE',
                           'VERIFICATION_SUCCESS','VERIFICATION_FAILED','PAYMENT_RECEIVED',
                           'PAYMENT_FAILED','REVIEW_REQUEST','SYSTEM_ANNOUNCEMENT') NOT NULL,
  `relatedEntityId`   VARCHAR(191)     NULL,
  `relatedEntityType` VARCHAR(191)     NULL,
  `isRead`            TINYINT(1)   NOT NULL DEFAULT 0,
  `readAt`            DATETIME(3)      NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `notifications_userId_idx` (`userId`),
  INDEX `notifications_isRead_idx` (`isRead`),
  CONSTRAINT `notifications_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── reviews ─────────────────────────────────────────────────

CREATE TABLE `reviews` (
  `id`          VARCHAR(36)  NOT NULL,
  `itemId`      VARCHAR(36)  NOT NULL,
  `authorId`    VARCHAR(36)  NOT NULL,
  `recipientId` VARCHAR(36)  NOT NULL,
  `rating`      INT          NOT NULL,
  `comment`     TEXT             NULL,
  `reviewType`  ENUM('ITEM','USER') NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `reviews_itemId_idx`      (`itemId`),
  INDEX `reviews_authorId_idx`    (`authorId`),
  INDEX `reviews_recipientId_idx` (`recipientId`),
  CONSTRAINT `reviews_itemId_fkey`
    FOREIGN KEY (`itemId`)      REFERENCES `items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reviews_authorId_fkey`
    FOREIGN KEY (`authorId`)    REFERENCES `users` (`id`),
  CONSTRAINT `reviews_recipientId_fkey`
    FOREIGN KEY (`recipientId`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
