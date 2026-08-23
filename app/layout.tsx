import type { Metadata } from "next";
import "./globals.css";
import "./medusa-theme.css";

export const metadata: Metadata = {
  title: "Neverland Operations",
  description: "Neverland 庫存、寄賣與銷售分析系統",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
