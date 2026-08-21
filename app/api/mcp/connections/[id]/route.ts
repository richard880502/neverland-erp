import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { revokeConnection } from "@/lib/mcp/oauth";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const auth = await requireApiUser(); await revokeConnection((await context.params).id, auth.user.id); return NextResponse.json({ ok: true }); }
  catch (cause) { const error = authErrorResponse(cause); return NextResponse.json({ error: error?.error ?? (cause instanceof Error ? cause.message : "無法撤銷 MCP connection") }, { status: error?.status ?? 409 }); }
}
