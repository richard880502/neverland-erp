import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const MCP_SCOPES = [
  "dashboard:read", "products:read", "channels:read", "inventory:read", "movements:read", "sales:read", "sync:read",
  "inventory:write", "movements:reverse", "sync:run", "offline_access",
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const DEFAULT_MCP_SCOPES: McpScope[] = ["dashboard:read", "products:read", "channels:read", "inventory:read", "movements:read", "sales:read", "sync:read", "offline_access"];
const ACCESS_TOKEN_MINUTES = 15;
const REFRESH_TOKEN_DAYS = 30;
const CODE_MINUTES = 5;

type OAuthApplicationType = "web" | "native";
type ConfiguredClient = { name?: string; redirectUris: string[]; applicationType?: OAuthApplicationType };
type OAuthClient = { name: string; redirectUris: string[]; applicationType: OAuthApplicationType };

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function randomToken() { return randomBytes(32).toString("base64url"); }

export function baseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  return `${protocol}://${host}`;
}

export function requireHttpsInProduction(request: Request) {
  if (process.env.NODE_ENV === "production" && !baseUrl(request).startsWith("https://")) throw new Error("MCP 必須透過 HTTPS 使用");
}

export function supportedScopes(raw: string | null | undefined) {
  const requested = (raw?.trim() ? raw.trim().split(/\s+/) : DEFAULT_MCP_SCOPES) as string[];
  const invalid = requested.filter((scope) => !MCP_SCOPES.includes(scope as McpScope));
  if (invalid.length) throw new Error(`不支援的 scope：${invalid.join(", ")}`);
  return [...new Set(requested)] as McpScope[];
}

export function validateAuthorizationResponseIssuer(received: string | null | undefined, expected: string) {
  if (!received || received !== expected) throw new Error("OAuth authorization response issuer 不符");
  return received;
}

function configuredClients(): Record<string, ConfiguredClient> {
  const raw = process.env.MCP_OAUTH_CLIENTS_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, ConfiguredClient>;
    return Object.fromEntries(Object.entries(parsed).filter(([, client]) => Array.isArray(client.redirectUris)));
  } catch { throw new Error("MCP_OAUTH_CLIENTS_JSON 格式無效"); }
}

function isPrivateClientMetadataHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "[::1]" || host.endsWith(".local")) return true;
  if (host === "::1" || host === "::" || /^f[cd][0-9a-f]:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

async function assertPublicClientMetadataHost(hostname: string) {
  if (isPrivateClientMetadataHost(hostname)) throw new Error("OAuth client metadata host 不允許使用本機或私有位址");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isIP(address) > 0 && isPrivateClientMetadataHost(address))) throw new Error("OAuth client metadata host 解析到私有位址");
}

async function clientFromMetadataDocument(clientId: string): Promise<OAuthClient | null> {
  let url: URL;
  try { url = new URL(clientId); } catch { return null; }
  if (url.protocol !== "https:" || url.pathname === "/" || url.hash || url.username || url.password || isPrivateClientMetadataHost(url.hostname)) return null;
  await assertPublicClientMetadataHost(url.hostname);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("無法讀取 OAuth client metadata document");
  const raw = await response.text();
  if (raw.length > 64_000) throw new Error("OAuth client metadata document 過大");
  const metadata = JSON.parse(raw) as Record<string, unknown>;
  if (metadata.client_id !== undefined && metadata.client_id !== clientId) throw new Error("OAuth client metadata 的 client_id 不符");
  if (!Array.isArray(metadata.redirect_uris) || !metadata.redirect_uris.every((value) => typeof value === "string")) throw new Error("OAuth client metadata 缺少 redirect_uris");
  const applicationType: OAuthApplicationType = metadata.application_type === "native" ? "native" : "web";
  const redirectUris = [...new Set(metadata.redirect_uris.map((value) => validateRedirectUri(value, applicationType)))];
  const name = typeof metadata.client_name === "string" ? metadata.client_name.trim().slice(0, 120) : url.hostname;
  return { name: name || url.hostname, redirectUris, applicationType };
}

function isLoopbackRedirectHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "localhost";
}

export function validateRedirectUri(value: string, applicationType: OAuthApplicationType = "web") {
  let uri: URL;
  try { uri = new URL(value); } catch { throw new Error("redirect_uri 無效"); }
  if (uri.hash || uri.username || uri.password) throw new Error("redirect_uri 不可含 fragment 或帳密");
  const loopbackHost = isLoopbackRedirectHost(uri.hostname);
  const nativeLoopback = applicationType === "native" && uri.protocol === "http:" && loopbackHost;
  if (uri.protocol !== "https:" && !nativeLoopback) throw new Error("redirect_uri 必須為 HTTPS；native client 僅可使用 HTTP loopback callback");
  return uri.toString();
}

export function redirectUriMatches(registeredValue: string, requestedValue: string, applicationType: OAuthApplicationType = "web") {
  const registered = new URL(validateRedirectUri(registeredValue, applicationType));
  const requested = new URL(validateRedirectUri(requestedValue, applicationType));
  if (registered.toString() === requested.toString()) return true;
  if (applicationType !== "native") return false;
  if (registered.protocol !== "http:" || requested.protocol !== "http:") return false;
  if (!isLoopbackRedirectHost(registered.hostname) || !isLoopbackRedirectHost(requested.hostname)) return false;
  return registered.hostname === requested.hostname
    && registered.pathname === requested.pathname
    && registered.search === requested.search;
}

export async function getClient(clientId: string, redirectUri: string): Promise<OAuthClient> {
  const dynamic = await prisma.oAuthClient.findUnique({ where: { clientId } });
  const client = dynamic
    ? { name: dynamic.clientName, redirectUris: dynamic.redirectUris, applicationType: dynamic.applicationType as OAuthApplicationType }
    : configuredClients()[clientId] ?? await clientFromMetadataDocument(clientId);
  if (!client) throw new Error("未註冊的 OAuth client");
  const applicationType = client.applicationType ?? "web";
  if (!client.redirectUris.some((registeredUri) => redirectUriMatches(registeredUri, redirectUri, applicationType))) throw new Error("redirect_uri 未註冊");
  return { name: client.name ?? clientId, redirectUris: client.redirectUris, applicationType };
}

export async function validateAuthorizationRequest(params: URLSearchParams, request: Request) {
  requireHttpsInProduction(request);
  const responseType = params.get("response_type"); const clientId = params.get("client_id"); const redirectUri = params.get("redirect_uri");
  const state = params.get("state"); const challenge = params.get("code_challenge"); const method = params.get("code_challenge_method");
  if (responseType !== "code" || !clientId || !redirectUri || !state || !challenge || method !== "S256") throw new Error("OAuth 授權請求必須使用 Authorization Code、state 與 PKCE S256");
  if (challenge.length < 43 || challenge.length > 128 || !/^[A-Za-z0-9\-._~]+$/.test(challenge)) throw new Error("無效的 PKCE code_challenge");
  const resource = params.get("resource"); const expectedResource = `${baseUrl(request)}/mcp`;
  if (resource && resource !== expectedResource) throw new Error("OAuth token resource 不符");
  const client = await getClient(clientId, redirectUri);
  validateRedirectUri(redirectUri, client.applicationType);
  return { clientId, clientName: client.name, redirectUri, state, codeChallenge: challenge, requestedScopes: supportedScopes(params.get("scope")), resource: expectedResource };
}

export async function registerDynamicClient(input: { redirectUris: string[]; clientName?: string; applicationType?: string; grantTypes?: string[]; responseTypes?: string[]; tokenEndpointAuthMethod?: string }) {
  if (!Array.isArray(input.redirectUris) || input.redirectUris.length < 1 || input.redirectUris.length > 20) throw new Error("redirect_uris 必須介於 1 至 20 個");
  if (input.tokenEndpointAuthMethod && input.tokenEndpointAuthMethod !== "none") throw new Error("Dynamic MCP client 僅支援 public client（token_endpoint_auth_method=none）");
  if (input.grantTypes?.some((type) => !["authorization_code", "refresh_token"].includes(type)) || input.responseTypes?.some((type) => type !== "code")) throw new Error("OAuth client grant 或 response type 不支援");
  const applicationType: OAuthApplicationType = input.applicationType === "native" ? "native" : "web";
  if (input.applicationType && !["native", "web"].includes(input.applicationType)) throw new Error("application_type 僅支援 native 或 web");
  const redirectUris = [...new Set(input.redirectUris.map((uri) => validateRedirectUri(uri, applicationType)))];
  const clientName = input.clientName?.trim().slice(0, 120) || "MCP client";
  const clientId = `mcp_client_${randomBytes(24).toString("base64url")}`;
  await prisma.oAuthClient.create({ data: { clientId, clientName, redirectUris, applicationType } });
  return { client_id: clientId, client_name: clientName, redirect_uris: redirectUris, application_type: applicationType, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
}

export async function issueAuthorizationCode(input: { userId: string; clientId: string; clientName: string; redirectUri: string; codeChallenge: string; scopes: McpScope[]; userAgent: string | null }) {
  const code = randomToken();
  await prisma.$transaction(async (tx) => {
    const connection = await tx.mcpConnection.create({ data: { userId: input.userId, clientId: input.clientId, clientName: input.clientName, scopes: input.scopes, userAgent: input.userAgent } });
    await tx.oAuthAuthorizationCode.create({ data: { codeHash: sha256(code), userId: input.userId, connectionId: connection.id, clientId: input.clientId, redirectUri: input.redirectUri, codeChallenge: input.codeChallenge, scopes: input.scopes, expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) } });
    await tx.auditLog.create({ data: { userId: input.userId, action: "MCP_CONNECTION_AUTHORIZED", entityType: "McpConnection", entityId: connection.id, metadata: { clientId: input.clientId, scopes: input.scopes, source: "MCP" } } });
  });
  return code;
}

function verifyPkce(verifier: string, challenge: string) {
  const expected = createHash("sha256").update(verifier).digest("base64url");
  const expectedBytes = Buffer.from(expected); const actualBytes = Buffer.from(challenge);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

async function issueTokens(connection: { id: string; userId: string; clientId: string; scopes: string[] }, audience: string) {
  const accessToken = randomToken(); const refreshToken = randomToken();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_MINUTES * 60_000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000);
  await prisma.$transaction([
    prisma.oAuthAccessToken.create({ data: { tokenHash: sha256(accessToken), userId: connection.userId, connectionId: connection.id, clientId: connection.clientId, audience, scopes: connection.scopes, expiresAt: accessExpiresAt } }),
    prisma.oAuthRefreshToken.create({ data: { tokenHash: sha256(refreshToken), connectionId: connection.id, clientId: connection.clientId, scopes: connection.scopes, expiresAt: refreshExpiresAt } }),
  ]);
  return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_MINUTES * 60, refresh_token: refreshToken, scope: connection.scopes.join(" ") };
}

export async function exchangeAuthorizationCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string; audience: string }) {
  const code = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: sha256(input.code) }, include: { connection: true } });
  if (!code || code.usedAt || code.expiresAt <= new Date() || code.clientId !== input.clientId || code.redirectUri !== input.redirectUri || code.connection.revokedAt || !verifyPkce(input.codeVerifier, code.codeChallenge)) throw new Error("invalid_grant");
  const used = await prisma.oAuthAuthorizationCode.updateMany({ where: { id: code.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw new Error("invalid_grant");
  return issueTokens(code.connection, input.audience);
}

export async function rotateRefreshToken(input: { refreshToken: string; clientId: string; audience: string }) {
  const refresh = await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256(input.refreshToken) }, include: { connection: true } });
  if (!refresh || refresh.clientId !== input.clientId || refresh.revokedAt || refresh.rotatedAt || refresh.expiresAt <= new Date() || refresh.connection.revokedAt) throw new Error("invalid_grant");
  const rotated = await prisma.oAuthRefreshToken.updateMany({ where: { id: refresh.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: new Date() } });
  if (rotated.count !== 1) throw new Error("invalid_grant");
  return issueTokens(refresh.connection, input.audience);
}

export type McpAuth = { userId: string; role: UserRole; scopes: McpScope[]; connectionId: string; clientId: string };

export async function authenticateMcpAccessToken(token: string, audience: string): Promise<McpAuth | null> {
  const access = await prisma.oAuthAccessToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true, connection: true } });
  if (!access || access.audience !== audience || access.expiresAt <= new Date() || access.revokedAt || access.connection.revokedAt || !access.user.active) return null;
  await prisma.$transaction([
    prisma.oAuthAccessToken.update({ where: { id: access.id }, data: { lastUsedAt: new Date() } }),
    prisma.mcpConnection.update({ where: { id: access.connectionId }, data: { lastUsedAt: new Date() } }),
  ]);
  return { userId: access.userId, role: access.user.role, scopes: access.scopes as McpScope[], connectionId: access.connectionId, clientId: access.clientId };
}

export async function revokeToken(token: string) {
  const hash = sha256(token); const now = new Date();
  const [access, refresh] = await prisma.$transaction([
    prisma.oAuthAccessToken.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: now } }),
    prisma.oAuthRefreshToken.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  return access.count + refresh.count > 0;
}

export async function revokeConnection(connectionId: string, userId: string) {
  const connection = await prisma.mcpConnection.findFirst({ where: { id: connectionId, userId, revokedAt: null } });
  if (!connection) throw new Error("找不到可撤銷的 MCP connection");
  const now = new Date();
  await prisma.$transaction([
    prisma.mcpConnection.update({ where: { id: connectionId }, data: { revokedAt: now } }),
    prisma.oAuthAccessToken.updateMany({ where: { connectionId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.oAuthRefreshToken.updateMany({ where: { connectionId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.auditLog.create({ data: { userId, action: "MCP_CONNECTION_REVOKED", entityType: "McpConnection", entityId: connectionId, metadata: { source: "WEB" } } }),
  ]);
}
