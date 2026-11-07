import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./refinement.css";
import "./mobile.css";
import "./auth.css";
import "../../../packages/design/tokens.generated.css";
import "./brand.css";
import { brandCopy } from "../../../packages/design/copy";
import TelemetryLifecycle from "../components/telemetry-lifecycle";
export const metadata: Metadata = {
  title: `Doompile — ${brandCopy.tagline}`,
  description: "Ссылки, находки и мысли — в одну кучу. Сохраняй статьи, видео и цитаты в Doompile.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/brand/app-32.png", sizes: "32x32", type: "image/png" }], apple: "/brand/app-192.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Doompile",
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111210",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t='system';try{t=localStorage.getItem('doompile-theme')||'system'}catch(e){}if(t!=='light'&&t!=='dark')t='system';var r=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.dataset.theme=r;document.documentElement.dataset.appearance=t;document.documentElement.style.colorScheme=r})()` }} />
      </head>
      <body><TelemetryLifecycle />{children}</body>
    </html>
  );
}
