import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deelrit",
  description: "Jullie gedeelde auto, kilometers en kosten op één plek.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
