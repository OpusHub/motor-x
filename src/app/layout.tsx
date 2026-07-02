import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo, Archivo_Black, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const body = Archivo({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600", "700"] });
const display = Archivo_Black({ subsets: ["latin"], variable: "--font-display", weight: "400" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "MOTOR X — @victoryulo",
  description: "Cockpit do motor de posts autônomos do X.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0f0d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${body.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
