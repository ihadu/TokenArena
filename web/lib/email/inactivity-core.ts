import { toZonedParts } from "@/lib/usage/date-range";
import { prisma } from "@/lib/prisma";
import { isNonWorkingDay } from "@/lib/holidays/cn";
import { sendInactivityReminder } from "./smtp";

export type SweepResult = { sent: number; skipped: number; resolved: number; failed: number };

async function getLastActiveDay(
  userId: string,
  range: { from: Date; to: Date },
): Promise<Date | null> {
  const [bucket, session] = await Promise.all([
    prisma.usageBucket.findFirst({
      where: { userId, bucketStart: { gte: range.from, lte: range.to } },
      orderBy: { bucketStart: "desc" },
      select: { bucketStart: true },
    }),
    prisma.usageSession.findFirst({
      where: { userId, firstMessageAt: { gte: range.from, lte: range.to } },
      orderBy: { firstMessageAt: "desc" },
      select: { firstMessageAt: true },
    }),
  ]);
  const dates = [bucket?.bucketStart, session?.firstMessageAt].filter(
    (d): d is Date => d !== null && d !== undefined,
  );
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

function formatYmd(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function nextDay(d: Date, timezone: string): Date {
  const p = toZonedParts(d, timezone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) + 24 * 60 * 60 * 1000);
}

function countInactiveBusinessDays(
  lastActive: Date | null,
  now: Date,
  timezone: string,
): number {
  const start = lastActive ?? new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  let cursor = nextDay(start, timezone);
  const nowYmd = formatYmd(toZonedParts(now, timezone));
  let count = 0;
  while (formatYmd(toZonedParts(cursor, timezone)) < nowYmd) {
    if (!isNonWorkingDay(cursor, timezone)) count++;
    cursor = nextDay(cursor, timezone);
  }
  return count;
}

export async function runInactivitySweep(now: Date = new Date()): Promise<SweepResult> {
  const users = await prisma.user.findMany({
    where: { usagePreference: { is: { timezone: { not: null } } } },
    select: {
      id: true,
      email: true,
      username: true,
      usagePreference: { select: { timezone: true, locale: true } },
    },
  });

  const lookbackStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const result: SweepResult = { sent: 0, skipped: 0, resolved: 0, failed: 0 };

  for (const user of users) {
    try {
      const tz = user.usagePreference?.timezone ?? "UTC";
      if (toZonedParts(now, tz).hour !== 9) continue;

      const lastActive = await getLastActiveDay(user.id, {
        from: lookbackStart,
        to: now,
      });
      const inactiveBizDays = countInactiveBusinessDays(lastActive, now, tz);

      const existing = await prisma.inactivityReminder.findFirst({
        where: { userId: user.id, resolvedAt: null },
        orderBy: { firstSentAt: "desc" },
      });

      if (inactiveBizDays < 3) {
        if (existing) {
          await prisma.inactivityReminder.update({
            where: { id: existing.id },
            data: { resolvedAt: now, updatedAt: now },
          });
          result.resolved++;
        }
        continue;
      }

      const isFirst = !existing;
      const isWeeklyDue =
        existing &&
        now.getTime() - existing.lastSentAt.getTime() >= 7 * 24 * 60 * 60 * 1000;

      if (!isFirst && !isWeeklyDue) {
        result.skipped++;
        continue;
      }

      await sendInactivityReminder({
        to: user.email,
        subject: "Token Arena inactivity reminder",
        html: `<p>${user.username}, you have been inactive for ${inactiveBizDays} business days.</p>`,
      });

      if (existing) {
        await prisma.inactivityReminder.update({
          where: { id: existing.id },
          data: { lastSentAt: now, sendCount: existing.sendCount + 1, updatedAt: now },
        });
      } else {
        await prisma.inactivityReminder.create({
          data: {
            userId: user.id,
            firstSentAt: now,
            lastSentAt: now,
            sendCount: 1,
            lastCheckAt: now,
          },
        });
      }
      result.sent++;
    } catch (err) {
      result.failed++;
      console.error(`[inactivity] failed for user ${user.id}`, err);
    }
  }

  return result;
}
