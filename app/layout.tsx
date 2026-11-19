import type { Metadata } from "next";
import { THEME_INITIALIZATION_SCRIPT } from "@/lib/color-theme";
import "./globals.css";
import "./medusa-theme.css";
import "./medusa-fixes.css";
import "./billing.css";
import "./ui-polish.css";
import "./product-master.css";
import "./color-modes.css";

export const metadata: Metadata = {
  title: "Neverland Operations",
  description: "Neverland 庫存、寄賣與銷售分析系統",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: THEME_INITIALIZATION_SCRIPT }} /></head>
    <body>{children}</body>
  </html>;
}
