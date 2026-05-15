import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chili Product Mockup Generator",
  description: "Standalone Chili product mockup generator with local layered rendering."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
