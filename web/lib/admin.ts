import "server-only";

import { prisma } from "./prisma";
import { getOptionalSession } from "./session";

export function parseAdminAllowlist(envValue: string | undefined): Set<string> {
  return new Set(
    (envValue ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

const ADMIN_ALLOWLIST: ReadonlySet<string> = parseAdminAllowlist(
  process.env.ADMIN_USERNAMES,
);

export function isAdminUsernameIn(
  allowlist: ReadonlySet<string>,
  username: string | null | undefined,
): boolean {
  if (!username) return false;
  return allowlist.has(username.trim().toLowerCase());
}

export function isAdminUsername(username: string | null | undefined): boolean {
  return isAdminUsernameIn(ADMIN_ALLOWLIST, username);
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const session = await getOptionalSession();
  return isAdminUsername(session?.user?.username);
}

export async function logAdminAccess(input: {
  viewerId: string;
  targetUserId: string;
  action: string;
}): Promise<void> {
  if (input.viewerId === input.targetUserId) return;
  try {
    await prisma.adminAccessLog.create({
      data: {
        viewerId: input.viewerId,
        targetUserId: input.targetUserId,
        action: input.action,
      },
    });
  } catch (err) {
    console.error("[admin] failed to write AdminAccessLog", err);
  }
}
