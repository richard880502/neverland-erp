import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { exportBillingStatement } from "@/lib/billing-export";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    const file = await exportBillingStatement(id, "pdf");
    return new Response(new Uint8Array(file.content), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return Response.json({ error: authError.error }, { status: authError.status });
    return Response.json({ error: error instanceof Error ? error.message : "PDF 匯出失敗" }, { status: 500 });
  }
}
