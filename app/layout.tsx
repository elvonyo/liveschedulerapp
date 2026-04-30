import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "LiveSupport Scheduler",
  description: "Organize live times, supporters, and planned gifts in one clean weekly view.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LiveSupport",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "LiveSupport",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0d0f1c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* iOS PWA icons */}
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icon-152.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/icon-120.png" />

        {/* iOS splash screens — helps with load speed */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

        {/* Service worker registration hint */}
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body style={{ margin: 0, padding: 0, background: "#0d0f1c" }}>
        {children}
      </body>
    </html>
  );
}
