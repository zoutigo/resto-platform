-- CreateEnum
CREATE TYPE "EmailCodePurpose" AS ENUM ('REGISTER', 'ADD_EMAIL', 'RESET');

-- CreateTable
CREATE TABLE "EmailCode" (
    "id" TEXT NOT NULL,
    "purpose" "EmailCodePurpose" NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audience" "AuthAudience",
    "name" TEXT,
    "passwordHash" TEXT,

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailCode_email_purpose_idx" ON "EmailCode"("email", "purpose");

