import type { Metadata } from "next";
import { Quicksand } from "next/font/google";
import "./globals.css";

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin", "vietnamese"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://studio-production-049c.up.railway.app";
const TITLE = "Storyboard Studio Director: type a story, get a film";
const DESCRIPTION =
  "Type a story in any language and get an animated film. A crew of NVIDIA Nemotron models on Nebius Token Factory writes every frame as code; a deterministic engine renders and measures each frame, and the crew fixes it.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Storyboard Studio Director",
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Storyboard Studio Director",
    images: [{ url: "/og.jpg", width: 1024, height: 576, alt: "A still from 夏休みの風鈴, a v2 film made by the Nemotron crew: a girl and her grandmother in a lit tea room" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.jpg"] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${quicksand.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
