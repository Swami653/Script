import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Электронный журнал",
    template: "%s · Электронный журнал",
  },
  description:
    "Школьный электронный журнал: 10-балльная система оценок, 4 четверти, роли администратора, учителя и ученика.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

/** Ставим тему до первой отрисовки, чтобы не было «вспышки» светлой темы. */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem("journal-theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (stored === "dark" || (!stored && prefersDark)) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background">{children}</body>
    </html>
  );
}
