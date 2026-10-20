-- DropIndex
DROP INDEX "LoyaltyProgram_salonId_idx";

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "walletNotice" TEXT;

-- CreateTable
CREATE TABLE "WalletSyncJob" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "notify" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletSyncJob_cardId_key" ON "WalletSyncJob"("cardId");

-- CreateIndex
CREATE INDEX "WalletSyncJob_nextAttemptAt_idx" ON "WalletSyncJob"("nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_salonId_key" ON "LoyaltyProgram"("salonId");

-- AddForeignKey
ALTER TABLE "WalletSyncJob" ADD CONSTRAINT "WalletSyncJob_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

