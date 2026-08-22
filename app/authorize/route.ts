import { NextResponse } from "next/server";
import { assertSameOrigin, getAuthContext } from "@/lib/auth";
import { baseUrl, issueAuthorizationCode, validateAuthorizationRequest } from "@/lib/mcp/oauth";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const highRisk = new Set(["inventory:write", "movements:reverse", "sync:run"]);
const scopeLabels: Record<string, { title: string; detail: string }> = {
  "dashboard:read": { title: "查看營運摘要", detail: "讀取庫存、低庫存與銷售概況。" },
  "products:read": { title: "讀取商品資料", detail: "搜尋並查看商品、SKU、尺寸與價格資料。" },
  "channels:read": { title: "讀取通路資料", detail: "查看目前啟用的銷售與寄賣通路。" },
  "inventory:read": { title: "讀取庫存", detail: "查看總倉、寄賣庫存與低庫存商品。" },
  "movements:read": { title: "讀取庫存異動", detail: "查詢入庫、出貨、寄賣與調整紀錄。" },
  "sales:read": { title: "讀取銷售資料", detail: "查看指定期間及各通路的銷售摘要。" },
  "sync:read": { title: "查看同步狀態", detail: "查看 Google Sheet 連線與同步工作狀態。" },
  "inventory:write": { title: "建立庫存異動", detail: "可新增入庫、出貨、寄賣及庫存調整紀錄。" },
  "movements:reverse": { title: "沖銷庫存異動", detail: "可建立反向紀錄，影響目前庫存數量。" },
  "sync:run": { title: "執行資料同步", detail: "可立即啟動 Google Sheet 同步及佇列處理。" },
  "offline_access": { title: "維持連線", detail: "允許 ChatGPT 以 refresh token 安全續期，不必頻繁重新登入。" },
};
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function page(title: string, content: string, status = 200) { return new NextResponse(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#e9e6df;color:#171816;font-family:"Helvetica Neue","PingFang TC","Noto Sans TC",Arial,sans-serif;background-image:radial-gradient(rgba(23,24,22,.055) .55px,transparent .55px);background-size:5px 5px}.shell{min-height:100vh;display:grid;grid-template-columns:minmax(240px,.72fr) minmax(0,1.28fr)}.brand-panel{position:relative;overflow:hidden;background:#171816;color:#f6f4ee;padding:38px 42px;display:flex;flex-direction:column}.brand-panel:after{content:"N";position:absolute;right:-48px;bottom:-75px;color:rgba(255,255,255,.035);font:700 410px/.75 Arial;letter-spacing:-.12em}.wordmark{font-size:27px;font-weight:800;letter-spacing:-.055em}.brand-meta,.foot,.kicker{font-size:8px;letter-spacing:.2em}.brand-meta{margin-top:7px;color:#8d8e88}.brand-copy{margin:auto 0;position:relative;z-index:1}.brand-copy span{color:#b95431;font-size:9px;letter-spacing:.22em}.brand-copy h2{margin:18px 0 20px;font-size:clamp(44px,5.4vw,76px);line-height:.88;letter-spacing:-.065em}.brand-copy p{max-width:340px;color:#a7a8a2;font-size:12px;line-height:1.8}.foot{color:#686963;position:relative;z-index:1}.content{padding:56px 6vw;display:flex;align-items:center}.card{width:100%;max-width:720px;margin:auto}.topline{display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid #171816;color:#6d6e69;font-size:8px;letter-spacing:.18em}.kicker{display:block;margin-top:28px;color:#b95431;font-weight:700}.card h1{margin:8px 0 10px;font-size:clamp(34px,4vw,52px);line-height:1;letter-spacing:-.055em}.intro{margin:0 0 8px;color:#555650;font-size:14px;line-height:1.7}.account{margin:0 0 28px;color:#777873;font-size:11px}.permissions-title{display:flex;justify-content:space-between;align-items:end;padding-bottom:10px;border-bottom:1px solid #171816}.permissions-title strong{font-size:13px}.permissions-title span{color:#777873;font-size:9px;letter-spacing:.08em}.scopes{display:grid;gap:1px;background:#cfcdc5;border-bottom:1px solid #171816}.scope{display:grid;grid-template-columns:26px 1fr auto;gap:10px;align-items:start;padding:15px 14px;background:#f7f6f1;cursor:pointer;transition:background .15s}.scope:hover{background:#fff}.scope input{width:16px;height:16px;margin:2px 0;accent-color:#b95431}.scope-name{display:block;font-size:13px;font-weight:700}.scope-detail{display:block;margin-top:4px;color:#6d6e69;font-size:11px;line-height:1.5}.risk{align-self:center;padding:5px 7px;border:1px solid #b95431;color:#a44228;font-size:8px;font-weight:800;letter-spacing:.1em;white-space:nowrap}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}button{min-height:46px;border:1px solid #171816;border-radius:0;padding:11px 20px;cursor:pointer;font-size:10px;font-weight:800;letter-spacing:.12em}.primary{background:#171816;color:#fff}.primary:hover{background:#b95431;border-color:#b95431}.secondary{background:transparent;color:#171816}.secondary:hover{background:#f7f6f1}.security{margin-top:22px;padding-top:13px;border-top:1px solid #cfcdc5;color:#747570;font-size:9px;line-height:1.6}.security b{color:#b95431}small{color:#6d6e69}@media(max-width:800px){.shell{display:block}.brand-panel{min-height:150px;padding:25px}.brand-copy{margin-top:30px}.brand-copy h2,.brand-copy p{display:none}.foot{margin-top:32px}.content{padding:32px 20px 50px}.actions button{flex:1}.risk{font-size:7px}}
</style></head><body><main class="shell"><aside class="brand-panel"><div><div class="wordmark">NEVERLAND</div><div class="brand-meta">OPERATIONS SYSTEM / PRIVATE ACCESS</div></div><div class="brand-copy"><span>AI CONNECTION / MCP</span><h2>Connect<br>with intent.</h2><p>每一個 AI 連線都綁定你的 ERP 帳號，權限清楚、可隨時撤銷。</p></div><div class="foot">NEVERLAND STUDIO® — INTERNAL MANAGEMENT</div></aside><section class="content"><div class="card">${content}</div></section></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); }
function queryFromForm(form: FormData) { const query = new URLSearchParams(); for (const key of ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"]) { const value = form.get(key); if (typeof value === "string") query.set(key, value); } return query; }

export async function GET(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!takeRateLimit(`authorize:${ip}`, 30).allowed) return page("請稍後再試", "<h1>請稍後再試</h1><p>授權請求次數過多。</p>", 429);
    const auth = await getAuthContext(); if (!auth) return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(`${new URL(request.url).pathname}${new URL(request.url).search}`)}`, baseUrl(request)));
    if (auth.user.mustChangePassword) return page("需要變更密碼", "<h1>請先變更密碼</h1><p>為保護 MCP connection，請先在 ERP 變更初始密碼。</p>", 403);
    const authorization = await validateAuthorizationRequest(new URL(request.url).searchParams, request);
    const options = authorization.requestedScopes.map((scope) => { const label = scopeLabels[scope] ?? { title: scope, detail: "允許 AI Assistant 使用此項功能。" }; return `<label class="scope"><input type="checkbox" name="scope" value="${escapeHtml(scope)}" ${highRisk.has(scope) ? "" : "checked"}><span><span class="scope-name">${escapeHtml(label.title)}</span><span class="scope-detail">${escapeHtml(label.detail)}</span></span>${highRisk.has(scope) ? '<span class="risk">需明確授權</span>' : ""}</label>`; }).join("");
    const hidden = [...new URL(request.url).searchParams.entries()].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join("");
    return page("授權 Neverland ERP MCP", `<div class="topline"><span>NEVERLAND / AUTHORIZATION</span><span>SECURE CONNECTION</span></div><span class="kicker">MCP ACCESS REQUEST</span><h1>授權 ${escapeHtml(authorization.clientName)}</h1><p class="intro">這個 AI Assistant 想要連線 Neverland ERP，請確認它可以使用的功能。</p><p class="account">將以 <b>${escapeHtml(auth.user.name || auth.user.email)}</b>（${escapeHtml(auth.user.role)}）建立獨立、可撤銷的連線。</p><form method="post" action="/authorize">${hidden}<div class="permissions-title"><strong>選擇允許的權限</strong><span>高風險操作預設不勾選</span></div><section class="scopes">${options}</section><div class="security"><b>◆</b> 實際權限仍受你的 ERP 角色限制；勾選項目不會提高原本帳號權限。</div><div class="actions"><button class="secondary" type="submit" name="decision" value="deny">拒絕</button><button class="primary" type="submit" name="decision" value="allow">允許並連線</button></div></form>`);
  } catch (cause) { return page("無效授權請求", `<h1>無效的授權請求</h1><p>${escapeHtml(cause instanceof Error ? cause.message : "請重新從 MCP client 發起連線")}</p>`, 400); }
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!takeRateLimit(`authorize:${ip}`, 30).allowed) return page("請稍後再試", "<h1>請稍後再試</h1><p>授權請求次數過多。</p>", 429);
    assertSameOrigin(request); const auth = await getAuthContext(); if (!auth || auth.user.mustChangePassword) return page("未授權", "<h1>請先登入並完成帳號設定</h1>", 401);
    const form = await request.formData(); const authorization = await validateAuthorizationRequest(queryFromForm(form), request);
    if (form.get("decision") !== "allow") { const denied = new URL(authorization.redirectUri); denied.searchParams.set("error", "access_denied"); denied.searchParams.set("state", authorization.state); denied.searchParams.set("iss", baseUrl(request)); return NextResponse.redirect(denied, 303); }
    const selected = form.getAll("scope").filter((scope): scope is string => typeof scope === "string"); const scopes = authorization.requestedScopes.filter((scope) => selected.includes(scope));
    if (!scopes.length) return page("請選擇權限", "<h1>請選擇至少一項授權範圍</h1><p>請返回上一頁選擇需要的 read scope。</p>", 400);
    const code = await issueAuthorizationCode({ userId: auth.user.id, clientId: authorization.clientId, clientName: authorization.clientName, redirectUri: authorization.redirectUri, codeChallenge: authorization.codeChallenge, scopes, userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null });
    const redirect = new URL(authorization.redirectUri); redirect.searchParams.set("code", code); redirect.searchParams.set("state", authorization.state); redirect.searchParams.set("iss", baseUrl(request)); return NextResponse.redirect(redirect, 303);
  } catch (cause) { return page("授權失敗", `<h1>授權失敗</h1><p>${escapeHtml(cause instanceof Error ? cause.message : "請重新嘗試")}</p>`, 400); }
}
