import { NextResponse } from "next/server";
import { z } from "zod";
import { registerDynamicClient, requireHttpsInProduction } from "@/lib/mcp/oauth";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  redirect_uris: z.array(z.string().max(2048)).min(1).max(20),
  client_name: z.string().trim().max(120).optional(),
  grant_types: z.array(z.string().max(80)).max(5).optional(),
  response_types: z.array(z.string().max(80)).max(5).optional(),
  token_endpoint_auth_method: z.string().max(80).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    requireHttpsInProduction(request);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
    const rate = takeRateLimit(`register:${ip}`, 10, 60 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "invalid_client_metadata", error_description: "Too many client registration requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const input = schema.safeParse(await request.json());
    if (!input.success) return NextResponse.json({ error: "invalid_client_metadata", error_description: "Invalid OAuth client metadata" }, { status: 400 });
    return NextResponse.json(await registerDynamicClient({ redirectUris: input.data.redirect_uris, clientName: input.data.client_name, grantTypes: input.data.grant_types, responseTypes: input.data.response_types, tokenEndpointAuthMethod: input.data.token_endpoint_auth_method }), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return NextResponse.json({ error: "invalid_client_metadata", error_description: cause instanceof Error ? cause.message : "Client registration failed" }, { status: 400 }); }
}
