import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getCurrentUser } from "@/lib/auth";
import { PasswordForm } from "@/components/PasswordForm";

export const dynamic = "force-dynamic";

export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) return <AppShell user={user}><PasswordForm forced /></AppShell>;
  return <AppShell user={user}>{children}</AppShell>;
}
