"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, LogOut, Pencil, Plus, UserCheck, UserX, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import type { UserRole } from "@prisma/client";

const roleLabels: Record<UserRole, string> = { ADMIN: "管理員", STAFF: "庫存人員", VIEWER: "檢視者" };
const actionLabels: Record<string, string> = {
  USER_CREATED: "建立使用者", USER_UPDATED: "更新使用者", USER_NAME_UPDATED: "修改顯示名稱", USER_DISABLED: "停用使用者", USER_ENABLED: "啟用使用者",
  PASSWORD_RESET: "重設密碼", PASSWORD_CHANGED: "變更密碼", SESSIONS_REVOKED: "撤銷登入", LOGIN_SUCCESS: "登入成功", LOGIN_FAILED: "登入失敗",
  PRODUCT_CREATED: "建立商品", PRODUCT_ENABLED: "啟用商品", PRODUCT_DISABLED: "停用商品", PRODUCT_DELETED: "刪除商品",
  CHANNEL_CREATED: "建立通路", CHANNEL_ENABLED: "啟用通路", CHANNEL_DISABLED: "停用通路", CHANNEL_DELETED: "刪除通路",
  LOGIN_PASSWORD_VERIFIED: "密碼驗證成功", TOTP_SETUP_STARTED: "開始設定雙重驗證", TOTP_ENABLED: "啟用雙重驗證",
  TOTP_DISABLED: "停用雙重驗證", TOTP_RECOVERY_CODES_REGENERATED: "重建備援碼",
};

type ManagedUser = { id: string; name: string; email: string; role: UserRole; active: boolean; mustChangePassword: boolean; twoFactorEnabled: boolean; failedLoginCount: number; lockedUntil: string | null; lastLoginAt: string | null; sessionCount: number; createdAt: string };
type Audit = { id: string; action: string; entityType: string; entityId: string | null; actor: string; email: string | null; createdAt: string };

export function UserManager({ currentUserId, users, auditLogs }: { currentUserId: string; users: ManagedUser[]; auditLogs: Audit[] }) {
  const router = useRouter(); const [error, setError] = useState(""); const [temporaryPassword, setTemporaryPassword] = useState<{ email: string; password: string } | null>(null); const [loadingId, setLoadingId] = useState("");
  const [editingUserId, setEditingUserId] = useState(""); const [editingName, setEditingName] = useState("");

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; setError(""); setTemporaryPassword(null); setLoadingId("create");
    const response = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(formElement))) });
    const result = await response.json(); setLoadingId("");
    if (!response.ok) return setError(result.error ?? "建立失敗");
    formElement.reset(); setTemporaryPassword({ email: result.user.email, password: result.temporaryPassword }); router.refresh();
  }

  async function updateUser(id: string, body: Record<string, unknown>) {
    setError(""); setLoadingId(id);
    const response = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); setLoadingId("");
    if (!response.ok) { setError(result.error ?? "更新失敗"); return false; }
    router.refresh(); return true;
  }

  async function saveDisplayName(event: React.FormEvent<HTMLFormElement>, user: ManagedUser) {
    event.preventDefault();
    const name = editingName.trim();
    if (!name) return setError("顯示名稱不可空白");
    if (name === user.name) { setEditingUserId(""); return; }
    if (await updateUser(user.id, { name })) { setEditingUserId(""); setEditingName(""); }
  }

  async function resetPassword(user: ManagedUser) {
    if (!confirm(`確定要重設 ${user.name} 的密碼？目前登入裝置會全部登出。`)) return;
    setLoadingId(user.id); setTemporaryPassword(null);
    const response = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" }); const result = await response.json(); setLoadingId("");
    if (!response.ok) return setError(result.error ?? "重設失敗"); setTemporaryPassword({ email: user.email, password: result.temporaryPassword }); router.refresh();
  }

  async function revokeSessions(user: ManagedUser) {
    if (!confirm(`確定要登出 ${user.name} 的所有裝置？`)) return;
    setLoadingId(user.id); const response = await fetch(`/api/users/${user.id}/revoke-sessions`, { method: "POST" }); const result = await response.json(); setLoadingId("");
    if (!response.ok) return setError(result.error ?? "撤銷失敗"); router.refresh();
  }

  return <>
    <PageHeader eyebrow="Access control" title="使用者控管" description="管理帳號、角色、登入狀態與安全事件。" actions={<span className="badge green">{users.filter((u) => u.active).length} 位啟用</span>} />
    {error && <div className="form-error">{error}</div>}
    {temporaryPassword && <div className="temporary-password"><div><strong>臨時密碼只顯示這一次</strong><span>{temporaryPassword.email}</span></div><code>{temporaryPassword.password}</code><p>請安全地交給使用者；首次登入後系統會強制變更。</p></div>}
    <details className="panel drawer"><summary><span className="btn btn-primary"><Plus size={16} />新增使用者</span></summary>
      <form className="inline-form user-create-form" onSubmit={createUser}>
        <div className="field"><label htmlFor="user-name">姓名</label><input className="input" id="user-name" name="name" required /></div>
        <div className="field"><label htmlFor="user-email">電子郵件</label><input className="input" id="user-email" name="email" type="email" required /></div>
        <div className="field"><label htmlFor="user-role">角色</label><select className="select" id="user-role" name="role" defaultValue="STAFF">{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <button className="btn btn-primary" disabled={loadingId === "create"}>{loadingId === "create" ? "建立中…" : "建立並產生臨時密碼"}</button>
      </form>
    </details>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>使用者</th><th>角色</th><th>安全狀態</th><th>登入裝置</th><th>最後登入</th><th>帳號</th><th>操作</th></tr></thead><tbody>
      {users.map((user) => <tr key={user.id}><td>{editingUserId === user.id ? <form className="user-name-editor" onSubmit={(event) => saveDisplayName(event, user)}><input className="input" value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={100} autoFocus aria-label={`修改 ${user.name} 的顯示名稱`} /><button className="btn btn-primary icon-btn" disabled={loadingId === user.id || !editingName.trim()} title="儲存顯示名稱" aria-label="儲存顯示名稱"><Check size={14} /></button><button type="button" className="btn btn-secondary icon-btn" disabled={loadingId === user.id} onClick={() => { setEditingUserId(""); setEditingName(""); }} title="取消修改" aria-label="取消修改"><X size={14} /></button></form> : <div className="user-identity"><div><strong>{user.name}</strong><div className="muted small-text">{user.email}{user.id === currentUserId ? " · 目前帳號" : ""}</div></div><button className="name-edit-button" onClick={() => { setEditingUserId(user.id); setEditingName(user.name); setError(""); }} title="修改顯示名稱" aria-label={`修改 ${user.name} 的顯示名稱`}><Pencil size={13} /></button></div>}</td>
        <td><select className="select compact-select" aria-label={`${user.name}的角色`} value={user.role} disabled={loadingId === user.id || user.id === currentUserId} onChange={(event) => updateUser(user.id, { role: event.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td>
        <td><div className="status-stack">{user.mustChangePassword ? <span className="badge warn">待改密碼</span> : user.lockedUntil && new Date(user.lockedUntil) > new Date() ? <span className="badge warn">暫時鎖定</span> : <span className="badge green">正常</span>}<span className={`badge ${user.twoFactorEnabled ? "green" : ""}`}>{user.twoFactorEnabled ? "2FA" : "無 2FA"}</span></div></td>
        <td>{user.sessionCount} 個</td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-TW") : "尚未登入"}</td>
        <td><button className={`btn ${user.active ? "btn-danger" : "btn-secondary"}`} disabled={loadingId === user.id || user.id === currentUserId} onClick={() => updateUser(user.id, { active: !user.active })}>{user.active ? <><UserX size={14} />停用</> : <><UserCheck size={14} />啟用</>}</button></td>
        <td><div className="row-actions"><button className="btn btn-secondary" disabled={loadingId === user.id || user.id === currentUserId} onClick={() => resetPassword(user)} title="重設密碼"><KeyRound size={14} /></button><button className="btn btn-secondary" disabled={loadingId === user.id || user.sessionCount === 0 || user.id === currentUserId} onClick={() => revokeSessions(user)} title="登出所有裝置"><LogOut size={14} /></button></div></td>
      </tr>)}</tbody></table></div></section>
    <section className="panel audit-panel"><div className="panel-header"><h2>安全與權限稽核</h2><span>最近 50 筆</span></div><div className="table-wrap"><table><thead><tr><th>時間</th><th>操作者</th><th>事件</th><th>對象</th></tr></thead><tbody>{auditLogs.map((log) => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString("zh-TW")}</td><td>{log.actor}<div className="muted small-text">{log.email}</div></td><td><span className="badge">{actionLabels[log.action] ?? log.action}</span></td><td>{log.entityType}{log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ""}</td></tr>)}</tbody></table></div></section>
  </>;
}
