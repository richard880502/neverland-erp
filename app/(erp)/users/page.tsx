import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserManager } from "@/components/UserManager";

export default async function UsersPage() {
  const current = await getCurrentUser();
  if (!current || current.role !== "ADMIN") redirect("/");
  const [users, auditLogs] = await Promise.all([
    prisma.user.findMany({ include: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } } }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.auditLog.findMany({ include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return <UserManager currentUserId={current.id} users={users.map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, mustChangePassword: u.mustChangePassword,
    twoFactorEnabled: Boolean(u.totpEnabledAt && u.totpSecretEncrypted),
    failedLoginCount: u.failedLoginCount, lockedUntil: u.lockedUntil?.toISOString() ?? null, lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    sessionCount: u.sessions.length, createdAt: u.createdAt.toISOString(),
  }))} auditLogs={auditLogs.map((log) => ({
    id: log.id, action: log.action, entityType: log.entityType, entityId: log.entityId,
    actor: log.user?.name ?? "系統", email: log.user?.email ?? null, createdAt: log.createdAt.toISOString(),
  }))} />;
}
