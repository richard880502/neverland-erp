import { NextResponse } from "next/server";
import { MCP_SCOPES, baseUrl } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const origin = baseUrl(request);
  return NextResponse.json({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, revocation_endpoint: `${origin}/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], scopes_supported: MCP_SCOPES, token_endpoint_auth_methods_supported: ["none"], authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true }, { headers: { "Cache-Control": "no-store" } });
}
