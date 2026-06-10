-- CreateTable
CREATE TABLE "InactivityReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstSentAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastCheckAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3) NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InactivityReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InactivityReminder_userId_resolvedAt_idx" ON "InactivityReminder"("userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "InactivityReminder_lastCheckAt_idx" ON "InactivityReminder"("lastCheckAt");

-- AddForeignKey
ALTER TABLE "InactivityReminder" ADD CONSTRAINT "InactivityReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
