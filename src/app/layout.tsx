import type { Metadata, Viewport } from "next";
import InterfaceProvider from "@/components/providers/interface-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chili Product Mockup Generator",
  description: "Standalone Chili product mockup generator with local layered rendering."
};

export const viewport: Viewport = {
  themeColor: "#f5f5f7"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <InterfaceProvider>{children}</InterfaceProvider>
      </body>
    </html>
  );
}
