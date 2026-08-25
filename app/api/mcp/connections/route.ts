import { NextResponse } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const auth = await requireApiUser();
    const connections = await prisma.mcpConnection.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: "desc" }, select: { id: true, clientId: true, clientName: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true } });
    return NextResponse.json(connections);
  } catch (cause) { const error = authErrorResponse(cause); return NextResponse.json({ error: error?.error ?? "無法取得 MCP connections" }, { status: error?.status ?? 500 }); }
}
