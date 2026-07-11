import type { Metadata, Viewport } from "next";
import { Fredoka, Geist_Mono, Nunito_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  display: "swap",
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GitHub Motion Graph",
  description:
    "Interactive force-directed visualization of GitHub activity — repositories, commits, pull requests, and human/AI collaboration patterns.",
  openGraph: {
    title: "GitHub Motion Graph",
    description: "Visualize the topology of collaborative development.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f5f9f6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${nunitoSans.variable} ${fredoka.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
