-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RecoveryRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newPinHash" TEXT NOT NULL,
    "status" "RecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "ip" TEXT,

    CONSTRAINT "RecoveryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryRequest_userId_status_idx" ON "RecoveryRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "RecoveryRequest" ADD CONSTRAINT "RecoveryRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

