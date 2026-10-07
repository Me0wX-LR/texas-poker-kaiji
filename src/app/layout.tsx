import type { Metadata, Viewport } from "next";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import "@fontsource/silkscreen/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Texas Poker Kaiji",
  description: "An offline six-max Hold'em ladder. A static shove chart against 50 to 1,200 bots, scored with the slide Elo rules.",
  applicationName: "Texas Poker Kaiji",
  appleWebApp: {
    capable: true,
    title: "Kaiji",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#140e0b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
