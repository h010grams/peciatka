-- AlterTable
ALTER TABLE "LoyaltyProgram" ADD COLUMN     "firstStampOnJoin" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "StampEvent" ALTER COLUMN "actorUserId" DROP NOT NULL;

