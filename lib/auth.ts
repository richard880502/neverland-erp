import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "stockflow_session";
const MFA_COOKIE_NAME = "stockflow_mfa_challenge";
const SESSION_DAYS = 7;
const MFA_CHALLENGE_MINUTES = 5;

export function clientIp(request?: Request) {
  if (!request) return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, request?: Request) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({
    data: {
      tokenHash: tokenHash(token), userId, expiresAt,
      ipAddress: clientIp(request), userAgent: request?.headers.get("user-agent")?.slice(0, 500) ?? null,
    },
  });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
  jar.delete(MFA_COOKIE_NAME);
}

export async function createLoginChallenge(userId: string, request?: Request) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_MINUTES * 60_000);
  await prisma.$transaction([
    prisma.loginChallenge.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.loginChallenge.create({ data: {
      tokenHash: tokenHash(token), userId, expiresAt, ipAddress: clientIp(request),
      userAgent: request?.headers.get("user-agent")?.slice(0, 500) ?? null,
    } }),
  ]);
  const jar = await cookies();
  jar.set(MFA_COOKIE_NAME, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: MFA_CHALLENGE_MINUTES * 60,
  });
}

export async function getLoginChallenge() {
  const token = (await cookies()).get(MFA_COOKIE_NAME)?.value;
  if (!token) return null;
  return prisma.loginChallenge.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
}

export async function clearLoginChallenge(markUsed = true) {
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE_NAME)?.value;
  if (token && markUsed) await prisma.loginChallenge.updateMany({ where: { tokenHash: tokenHash(token), usedAt: null }, data: { usedAt: new Date() } });
  jar.delete(MFA_COOKIE_NAME);
}

export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) await prisma.session.updateMany({ where: { tokenHash: tokenHash(token), revokedAt: null }, data: { revokedAt: new Date() } });
  jar.delete(COOKIE_NAME);
  const challengeToken = jar.get(MFA_COOKIE_NAME)?.value;
  if (challengeToken) await prisma.loginChallenge.updateMany({ where: { tokenHash: tokenHash(challengeToken), usedAt: null }, data: { usedAt: new Date() } });
  jar.delete(MFA_COOKIE_NAME);
}

export async function getAuthContext() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) return null;
  return {
    sessionId: session.id,
    user: {
      id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role,
      active: session.user.active, mustChangePassword: session.user.mustChangePassword, lastLoginAt: session.user.lastLoginAt,
      twoFactorEnabled: Boolean(session.user.totpEnabledAt && session.user.totpSecretEncrypted),
    },
  };
}

export async function getCurrentUser() {
  return (await getAuthContext())?.user ?? null;
}

export async function requireApiUser(options?: { roles?: UserRole[]; allowPasswordChange?: boolean }) {
  const context = await getAuthContext();
  if (!context) throw new Error("UNAUTHORIZED");
  if (context.user.mustChangePassword && !options?.allowPasswordChange) throw new Error("PASSWORD_CHANGE_REQUIRED");
  if (options?.roles && !options.roles.includes(context.user.role)) throw new Error("FORBIDDEN");
  return context;
}

export function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return { error: "請重新登入", status: 401 };
  if (message === "PASSWORD_CHANGE_REQUIRED") return { error: "請先變更初始密碼", status: 403 };
  if (message === "FORBIDDEN") return { error: "權限不足", status: 403 };
  return null;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || requestUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || requestUrl.protocol.replace(":", "");

  let submittedOrigin: URL;
  try {
    submittedOrigin = new URL(origin);
  } catch {
    throw new Error("INVALID_ORIGIN");
  }

  if (submittedOrigin.host !== host || submittedOrigin.protocol !== `${protocol}:`) {
    throw new Error("INVALID_ORIGIN");
  }
}

export function validatePassword(password: string) {
  if (password.length < 10) return "密碼至少需要 10 個字元";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return "密碼需包含英文大小寫與數字";
  return null;
}

export function generateTemporaryPassword() {
  return `Sf${randomBytes(9).toString("base64url")}9A`;
}
