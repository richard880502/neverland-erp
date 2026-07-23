import { PasswordForm } from "@/components/PasswordForm";
import { TwoFactorManager } from "@/components/TwoFactorManager";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  const user = await getCurrentUser();
  const recoveryCodesRemaining = user?.twoFactorEnabled ? await prisma.totpRecoveryCode.count({ where: { userId: user.id, usedAt: null } }) : 0;
  const recoveryCodeUsed = (await searchParams).recovery === "used";
  return (
    <>
      <header className="page-header"><div><div className="eyebrow">Security</div><h1>帳號與安全</h1><p>管理目前登入帳號的密碼與安全設定。</p></div></header>
      <section className="panel account-summary">
        <div><span>姓名</span><strong>{user?.name}</strong></div>
        <div><span>電子郵件</span><strong>{user?.email}</strong></div>
        <div><span>角色</span><strong>{user?.role === "ADMIN" ? "管理員" : user?.role === "STAFF" ? "庫存人員" : "檢視者"}</strong></div>
      </section>
      <PasswordForm />
      <TwoFactorManager enabled={user?.twoFactorEnabled ?? false} recoveryCodesRemaining={recoveryCodesRemaining} recoveryCodeUsed={recoveryCodeUsed} />
    </>
  );
}
