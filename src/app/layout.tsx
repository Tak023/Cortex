import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cortex — Agentic OS",
  description:
    "Local-first control plane for orchestrating AI agents and models",
  applicationName: "Cortex",
  icons: {
    icon: [
      { url: "/branding/cortex.jpg", type: "image/jpeg" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Cortex — Agentic OS",
    description:
      "Local-first control plane for orchestrating AI agents and models",
    images: [{ url: "/branding/cortex.jpg", width: 1024, height: 1024 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full dark">
      <body className="min-h-full antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
