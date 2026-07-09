import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GitHub Motion Graph",
  description: "Interactive force-directed visualization of GitHub activity — repositories, commits, pull requests, and human/AI collaboration patterns.",
  openGraph: {
    title: "GitHub Motion Graph",
    description: "Visualize the topology of collaborative development.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistMono.variable} dark`}>
      <body className="bg-zinc-950 text-zinc-100 antialiased min-h-screen">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
