import { NextResponse } from "next/server";
import { assertSameOrigin, getAuthContext } from "@/lib/auth";
import { baseUrl, issueAuthorizationCode, validateAuthorizationRequest } from "@/lib/mcp/oauth";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const highRisk = new Set(["inventory:write", "movements:reverse", "sync:run", "billing:write"]);
const scopeLabels: Record<string, { title: string; detail: string }> = {
  "dashboard:read": { title: "查看營運摘要", detail: "讀取庫存、低庫存與銷售概況。" },
  "products:read": { title: "讀取商品資料", detail: "搜尋並查看商品、SKU、尺寸與價格資料。" },
  "channels:read": { title: "讀取通路資料", detail: "查看目前啟用的銷售與寄賣通路。" },
  "inventory:read": { title: "讀取庫存", detail: "查看總倉、寄賣庫存與低庫存商品。" },
  "movements:read": { title: "讀取庫存異動", detail: "查詢入庫、出貨、寄賣與調整紀錄。" },
  "sales:read": { title: "讀取銷售資料", detail: "查看指定期間及各通路的銷售摘要。" },
  "sync:read": { title: "查看同步狀態", detail: "查看 Google Sheet 連線與同步工作狀態。" },
  "billing:read": { title: "讀取請款資料", detail: "查看、搜尋與預覽請款單及應收金額。" },
  "inventory:write": { title: "建立庫存異動", detail: "可新增入庫、出貨、寄賣及庫存調整紀錄。" },
  "movements:reverse": { title: "沖銷庫存異動", detail: "可建立反向紀錄，影響目前庫存數量。" },
  "sync:run": { title: "執行資料同步", detail: "可立即啟動 Google Sheet 同步及佇列處理。" },
  "billing:write": { title: "建立與管理請款", detail: "可建立正式請款單、作廢請款單並建立 Google 試算表請款頁籤；操作前仍需再次確認。" },
  "offline_access": { title: "維持連線", detail: "允許 ChatGPT 以 refresh token 安全續期，不必頻繁重新登入。" },
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function page(title: string, content: string, status = 200) {
  return new NextResponse(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title><style>
:root{--bg:#fafafa;--surface:#fff;--surface-subtle:#f4f4f5;--fg:#18181b;--fg-subtle:#52525b;--fg-muted:#71717a;--border:#e4e4e7;--border-strong:#d4d4d8;--blue:#3b82f6;--blue-strong:#2563eb;--blue-subtle:#eff6ff;--orange:#c2410c;--orange-border:#fed7aa;--orange-bg:#fff7ed;--shadow:0 8px 28px rgba(24,24,27,.08)}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100dvh;background:radial-gradient(circle at 20% 10%,rgba(59,130,246,.045),transparent 30%),var(--bg);color:var(--fg);font-family:Inter,"SF Pro Text","Helvetica Neue","PingFang TC","Noto Sans TC",Arial,sans-serif;-webkit-font-smoothing:antialiased}.page-shell{width:min(720px,calc(100vw - 40px));min-height:100dvh;margin:0 auto;padding:40px 0;display:flex;flex-direction:column;justify-content:center}.brand-lockup{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 18px}.brand-mark{width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--border);border-radius:8px;background:var(--surface);box-shadow:0 1px 2px rgba(24,24,27,.04);font-size:11px;font-weight:700;line-height:1}.brand-copy{display:grid;gap:1px}.brand-copy strong{font-size:14px;line-height:1.2;font-weight:650;letter-spacing:-.01em}.brand-copy span{font-size:11px;line-height:1.2;color:var(--fg-muted)}.auth-card{width:100%;overflow:hidden;border:1px solid var(--border);border-radius:12px;background:var(--surface);box-shadow:var(--shadow);padding:28px}.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.eyebrow{display:block;margin:0 0 7px;color:var(--fg-muted);font-size:11px;font-weight:600;letter-spacing:.02em}.auth-card h1{margin:0;color:var(--fg);font-size:24px;line-height:1.25;letter-spacing:-.025em;font-weight:650}.auth-card>p:not(.page-foot){color:var(--fg-subtle)}.secure-badge{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;border:1px solid #bfdbfe;border-radius:999px;background:var(--blue-subtle);padding:5px 8px;color:var(--blue-strong);font-size:10px;font-weight:600;white-space:nowrap}.secure-badge:before{content:"";width:6px;height:6px;border-radius:999px;background:var(--blue)}.intro{margin:12px 0 6px;color:var(--fg-subtle);font-size:13px;line-height:1.65}.account{margin:0 0 24px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface-subtle);color:var(--fg-muted);font-size:11px;line-height:1.5}.account b{color:var(--fg);font-weight:600}.permissions-title{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:0 0 8px}.permissions-title strong{font-size:12px;font-weight:650}.permissions-title span{color:var(--fg-muted);font-size:10px}.scopes{overflow:hidden;border:1px solid var(--border);border-radius:9px;background:var(--surface)}.scope{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:10px;align-items:start;padding:13px 14px;cursor:pointer;transition:background .15s ease}.scope+.scope{border-top:1px solid var(--border)}.scope:hover{background:#fafafa}.scope:has(input:focus-visible){outline:3px solid rgba(59,130,246,.16);outline-offset:-3px}.scope input{width:16px;height:16px;margin:1px 0 0;accent-color:var(--blue)}.scope-name{display:block;color:var(--fg);font-size:12px;font-weight:600;line-height:1.35}.scope-detail{display:block;margin-top:3px;color:var(--fg-muted);font-size:11px;line-height:1.5}.risk{align-self:center;border:1px solid var(--orange-border);border-radius:999px;background:var(--orange-bg);padding:4px 7px;color:var(--orange);font-size:9px;font-weight:600;white-space:nowrap}.security{display:flex;gap:9px;align-items:flex-start;margin-top:14px;padding:11px 12px;border:1px solid #dbeafe;border-radius:8px;background:#f8fbff;color:var(--fg-muted);font-size:10px;line-height:1.55}.security b{display:grid;place-items:center;flex:0 0 18px;width:18px;height:18px;border-radius:999px;background:var(--blue-subtle);color:var(--blue-strong);font-size:10px}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}button{min-height:36px;border-radius:7px;padding:8px 13px;cursor:pointer;font:600 12px/1 Inter,"SF Pro Text","Helvetica Neue",Arial,sans-serif;transition:background .15s,border-color .15s,box-shadow .15s}button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(59,130,246,.16)}.primary{border:1px solid #18181b;background:#18181b;color:#fff}.primary:hover{background:#27272a;border-color:#27272a}.secondary{border:1px solid var(--border-strong);background:var(--surface);color:var(--fg)}.secondary:hover{background:var(--surface-subtle)}.page-foot{margin:12px 0 0;text-align:center;color:var(--fg-muted);font-size:10px;line-height:1.5}.auth-card>h1:first-child{font-size:22px}.auth-card>h1:first-child+p{margin:10px 0 0;color:var(--fg-subtle);font-size:13px;line-height:1.6}@media(max-width:640px){.page-shell{width:min(100% - 28px,720px);padding:24px 0;justify-content:flex-start}.auth-card{padding:20px}.card-head{display:block}.secure-badge{margin-top:12px}.scope{grid-template-columns:22px minmax(0,1fr)}.risk{grid-column:2;justify-self:start}.permissions-title{align-items:flex-start}.permissions-title span{text-align:right}.actions{display:grid;grid-template-columns:1fr 1fr}.actions button{width:100%}}@media(max-height:760px){.page-shell{justify-content:flex-start}}
</style></head><body><main class="page-shell"><div class="brand-lockup"><span class="brand-mark">N</span><span class="brand-copy"><strong>Neverland</strong><span>Operations</span></span></div><section class="auth-card">${content}</section><p class="page-foot">Neverland ERP · Secure OAuth authorization</p></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function queryFromForm(form: FormData) {
  const query = new URLSearchParams();
  for (const key of ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"]) {
    const value = form.get(key);
    if (typeof value === "string") query.set(key, value);
  }
  return query;
}

export async function GET(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!takeRateLimit(`authorize:${ip}`, 30).allowed) return page("請稍後再試", "<h1>請稍後再試</h1><p>授權請求次數過多。</p>", 429);
    const auth = await getAuthContext();
    if (!auth) return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(`${new URL(request.url).pathname}${new URL(request.url).search}`)}`, baseUrl(request)));
    if (auth.user.mustChangePassword) return page("需要變更密碼", "<h1>請先變更密碼</h1><p>為保護 MCP connection，請先在 ERP 變更初始密碼。</p>", 403);
    const authorization = await validateAuthorizationRequest(new URL(request.url).searchParams, request);
    const options = authorization.requestedScopes.map((scope) => {
      const label = scopeLabels[scope] ?? { title: scope, detail: "允許 AI Assistant 使用此項功能。" };
      return `<label class="scope"><input type="checkbox" name="scope" value="${escapeHtml(scope)}" ${highRisk.has(scope) ? "" : "checked"}><span><span class="scope-name">${escapeHtml(label.title)}</span><span class="scope-detail">${escapeHtml(label.detail)}</span></span>${highRisk.has(scope) ? '<span class="risk">需明確授權</span>' : ""}</label>`;
    }).join("");
    const hidden = [...new URL(request.url).searchParams.entries()].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join("");
    return page("授權 Neverland ERP MCP", `<div class="card-head"><div><span class="eyebrow">MCP ACCESS REQUEST</span><h1>授權 ${escapeHtml(authorization.clientName)}</h1></div><span class="secure-badge">安全連線</span></div><p class="intro">這個 AI Assistant 想要連線 Neverland ERP，請確認它可以使用的功能。</p><p class="account">將以 <b>${escapeHtml(auth.user.name || auth.user.email)}</b>（${escapeHtml(auth.user.role)}）建立獨立、可撤銷的連線。</p><form method="post" action="/authorize">${hidden}<div class="permissions-title"><strong>選擇允許的權限</strong><span>高風險操作預設不勾選</span></div><section class="scopes">${options}</section><div class="security"><b>i</b><span>實際權限仍受你的 ERP 角色限制；勾選項目不會提高原本帳號權限。</span></div><div class="actions"><button class="secondary" type="submit" name="decision" value="deny">拒絕</button><button class="primary" type="submit" name="decision" value="allow">允許並連線</button></div></form>`);
  } catch (cause) {
    return page("無效授權請求", `<h1>無效的授權請求</h1><p>${escapeHtml(cause instanceof Error ? cause.message : "請重新從 MCP client 發起連線")}</p>`, 400);
  }
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!takeRateLimit(`authorize:${ip}`, 30).allowed) return page("請稍後再試", "<h1>請稍後再試</h1><p>授權請求次數過多。</p>", 429);
    assertSameOrigin(request);
    const auth = await getAuthContext();
    if (!auth || auth.user.mustChangePassword) return page("未授權", "<h1>請先登入並完成帳號設定</h1>", 401);
    const form = await request.formData();
    const authorization = await validateAuthorizationRequest(queryFromForm(form), request);
    if (form.get("decision") !== "allow") {
      const denied = new URL(authorization.redirectUri);
      denied.searchParams.set("error", "access_denied");
      denied.searchParams.set("state", authorization.state);
      denied.searchParams.set("iss", baseUrl(request));
      return NextResponse.redirect(denied, 303);
    }
    const selected = form.getAll("scope").filter((scope): scope is string => typeof scope === "string");
    const scopes = authorization.requestedScopes.filter((scope) => selected.includes(scope));
    if (!scopes.length) return page("請選擇權限", "<h1>請選擇至少一項授權範圍</h1><p>請返回上一頁選擇需要的 read scope。</p>", 400);
    const code = await issueAuthorizationCode({ userId: auth.user.id, clientId: authorization.clientId, clientName: authorization.clientName, redirectUri: authorization.redirectUri, codeChallenge: authorization.codeChallenge, scopes, userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
    const redirect = new URL(authorization.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", authorization.state);
    redirect.searchParams.set("iss", baseUrl(request));
    return NextResponse.redirect(redirect, 303);
  } catch (cause) {
    return page("授權失敗", `<h1>授權失敗</h1><p>${escapeHtml(cause instanceof Error ? cause.message : "請重新嘗試")}</p>`, 400);
  }
}
