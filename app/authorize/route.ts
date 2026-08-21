import { NextResponse } from "next/server";
import { assertSameOrigin, getAuthContext } from "@/lib/auth";
import { baseUrl, issueAuthorizationCode, validateAuthorizationRequest } from "@/lib/mcp/oauth";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const highRisk = new Set(["inventory:write", "movements:reverse", "sync:run"]);
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function page(title: string, content: string, status = 200) { return new NextResponse(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f6f5f1;color:#1e221f;max-width:680px;margin:5rem auto;padding:0 1.25rem}.card{background:#fff;padding:2rem;border:1px solid #d8d6cd;border-radius:12px}h1{margin-top:0}label{display:block;padding:.75rem 0;border-bottom:1px solid #eee}button{background:#1e221f;color:white;border:0;border-radius:6px;padding:.75rem 1rem;font-weight:600;margin:.5rem .5rem .5rem 0}.secondary{background:white;color:#1e221f;border:1px solid #999}small{color:#5c615d}</style></head><body><main class="card">${content}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); }
function queryFromForm(form: FormData) { const query = new URLSearchParams(); for (const key of ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"]) { const value = form.get(key); if (typeof value === "string") query.set(key, value); } return query; }

export async function GET(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!takeRateLimit(`authorize:${ip}`, 30).allowed) return page("請稍後再試", "<h1>請稍後再試</h1><p>授權請求次數過多。</p>", 429);
    const auth = await getAuthContext(); if (!auth) return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(`${new URL(request.url).pathname}${new URL(request.url).search}`)}`, baseUrl(request)));
    if (auth.user.mustChangePassword) return page("需要變更密碼", "<h1>請先變更密碼</h1><p>為保護 MCP connection，請先在 ERP 變更初始密碼。</p>", 403);
    const authorization = await validateAuthorizationRequest(new URL(request.url).searchParams, request);
    const options = authorization.requestedScopes.map((scope) => `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" ${highRisk.has(scope) ? "" : "checked"}> <b>${escapeHtml(scope)}</b>${highRisk.has(scope) ? " <small>需要明確授權</small>" : ""}</label>`).join("");
    const hidden = [...new URL(request.url).searchParams.entries()].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join("");
    return page("授權 Neverland ERP MCP", `<h1>授權 AI Assistant</h1><p><b>${escapeHtml(authorization.clientName)}</b> 想連線 Neverland ERP。</p><p>此連線會使用你的 ERP 角色權限；勾選 scope 不會提高原本角色的權限。</p><form method="post" action="/authorize">${hidden}<section>${options}</section><button type="submit" name="decision" value="allow">允許連線</button><button class="secondary" type="submit" name="decision" value="deny">拒絕</button></form>`);
  } catch (cause) { return page("無效授權請求", `<h1>無效的授權請求</h1><p>${escapeHtml(cause instanceof Error ? cause.message : "請重新從 MCP client 發起連線")}</p>`, 400); }
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!takeRateLimit(`authorize:${ip}`, 30).allowed) return page("請稍後再試", "<h1>請稍後再試</h1><p>授權請求次數過多。</p>", 429);
    assertSameOrigin(request); const auth = await getAuthContext(); if (!auth || auth.user.mustChangePassword) return page("未授權", "<h1>請先登入並完成帳號設定</h1>", 401);
    const form = await request.formData(); const authorization = await validateAuthorizationRequest(queryFromForm(form), request);
    if (form.get("decision") !== "allow") { const denied = new URL(authorization.redirectUri); denied.searchParams.set("error", "access_denied"); denied.searchParams.set("state", authorization.state); return NextResponse.redirect(denied); }
    const selected = form.getAll("scope").filter((scope): scope is string => typeof scope === "string"); const scopes = authorization.requestedScopes.filter((scope) => selected.includes(scope));
    if (!scopes.length) return page("請選擇權限", "<h1>請選擇至少一項授權範圍</h1><p>請返回上一頁選擇需要的 read scope。</p>", 400);
    const code = await issueAuthorizationCode({ userId: auth.user.id, clientId: authorization.clientId, clientName: authorization.clientName, redirectUri: authorization.redirectUri, codeChallenge: authorization.codeChallenge, scopes, userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
    const redirect = new URL(authorization.redirectUri); redirect.searchParams.set("code", code); redirect.searchParams.set("state", authorization.state); return NextResponse.redirect(redirect);
  } catch (cause) { return page("授權失敗", `<h1>授權失敗</h1><p>${escapeHtml(cause instanceof Error ? cause.message : "請重新嘗試")}</p>`, 400); }
}
