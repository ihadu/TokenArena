-- Admin cross-user dashboard view: audit log of admin viewing other users' full data.
CREATE TABLE "admin_access_log" (
  "id" TEXT NOT NULL,
  "viewerId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_access_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_access_log_targetUserId_createdAt_idx" ON "admin_access_log"("targetUserId", "createdAt");
CREATE INDEX "admin_access_log_viewerId_createdAt_idx" ON "admin_access_log"("viewerId", "createdAt");

ALTER TABLE "admin_access_log"
ADD CONSTRAINT "admin_access_log_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_access_log"
ADD CONSTRAINT "admin_access_log_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
