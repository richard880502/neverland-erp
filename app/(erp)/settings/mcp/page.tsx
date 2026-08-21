import { McpConnectionsManager } from "@/components/McpConnectionsManager";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function McpSettingsPage() {
  const user = await getCurrentUser();
  const connections = user ? await prisma.mcpConnection.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, clientId: true, clientName: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true } }) : [];
  return <div className="page-stack"><header className="page-header"><div><span className="eyebrow">SETTINGS / INTEGRATIONS</span><h1>AI Assistants / MCP</h1><p>管理可安全讀取與操作 Neverland ERP 的外部 AI connection。</p></div></header><McpConnectionsManager initialConnections={connections} /></div>;
}
