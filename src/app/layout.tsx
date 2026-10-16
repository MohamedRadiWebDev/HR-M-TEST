import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/cairo/arabic-400.css";
import "@fontsource/cairo/arabic-600.css";
import "@fontsource/cairo/arabic-700.css";
import "@fontsource/cairo/latin-400.css";
import "@fontsource/cairo/latin-600.css";
import "@fontsource/cairo/latin-700.css";
import "@fontsource/tajawal/arabic-500.css";
import "@fontsource/tajawal/arabic-700.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "نظام الحضور والانصراف",
  description: "نظام الحضور والانصراف ومعالجة الجزاءات والإجازات",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
