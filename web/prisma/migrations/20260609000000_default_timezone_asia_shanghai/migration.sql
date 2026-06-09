-- AlterTable
ALTER TABLE "UsagePreference" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Shanghai';

-- Backfill: only rows that were still on the prior default get updated.
-- Users who actively set any other timezone (e.g. 'America/New_York') are untouched.
UPDATE "UsagePreference"
SET "timezone" = 'Asia/Shanghai'
WHERE "timezone" = 'UTC';
