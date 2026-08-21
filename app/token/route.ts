import { NextResponse } from "next/server";
import { baseUrl, exchangeAuthorizationCode, getClient, requireHttpsInProduction, rotateRefreshToken } from "@/lib/mcp/oauth";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function oauthError(error: string, description: string, status = 400) { return NextResponse.json({ error, error_description: description }, { status, headers: { "Cache-Control": "no-store" } }); }

export async function POST(request: Request) {
  try {
    requireHttpsInProduction(request); const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"; const rate = takeRateLimit(`token:${ip}`, 30); if (!rate.allowed) return oauthError("slow_down", "Too many requests", 429);
    const form = await request.formData(); const grantType = form.get("grant_type"); const clientId = form.get("client_id");
    if (typeof clientId !== "string") return oauthError("invalid_request", "client_id is required"); const audience = `${baseUrl(request)}/mcp`;
    if (grantType === "authorization_code") {
      const code = form.get("code"), redirectUri = form.get("redirect_uri"), verifier = form.get("code_verifier");
      if (typeof code !== "string" || typeof redirectUri !== "string" || typeof verifier !== "string") return oauthError("invalid_request", "code, redirect_uri and code_verifier are required"); await getClient(clientId, redirectUri);
      return NextResponse.json(await exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier: verifier, audience }), { headers: { "Cache-Control": "no-store" } });
    }
    if (grantType === "refresh_token") { const refreshToken = form.get("refresh_token"); if (typeof refreshToken !== "string") return oauthError("invalid_request", "refresh_token is required"); return NextResponse.json(await rotateRefreshToken({ refreshToken, clientId, audience }), { headers: { "Cache-Control": "no-store" } }); }
    return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");
  } catch (cause) { const message = cause instanceof Error ? cause.message : "invalid_request"; return oauthError(message === "invalid_grant" ? "invalid_grant" : "invalid_request", message === "invalid_grant" ? "Authorization code or refresh token is invalid" : "Invalid OAuth request"); }
}
