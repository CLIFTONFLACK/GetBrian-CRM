import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "./analytics";

/**
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` resolve to a
 * real value instead of 0 — without it, bottom-docked UI sits under the iPhone
 * home indicator. `userScalable` is left alone so pinch-zoom stays available.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

/* Brand type, matching getbrian.xyz: Bricolage Grotesque sets headings (variable
   font, so 600-800 resolve; opsz tightens it at display sizes), DM Sans sets body
   copy. Mono is unspecified by the brand and stays Geist. */
const headingFont = Bricolage_Grotesque({
  variable: "--font-heading",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const bodyFont = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const monoFont = Geist_Mono({
  variable: "--font-mono-family",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://crm.getbrian.xyz"),
  // Same grammar as every sibling: "<Product>, built by Brian — <tagline>",
  // with inner pages as "<Page> · <Product>".
  title: {
    default: "CRM, built by Brian — for UK leisure property agents",
    template: "%s · CRM",
  },
  description:
    "The CRM that speaks fluent licensed premises. Track operators, landlords and listings, and let MatchMaker score every requirement against every listing. Built by Brian.",
  openGraph: {
    type: "website",
    siteName: "CRM by GetBrian",
    title: "CRM, built by Brian — for UK leisure property agents",
    description:
      "The CRM that speaks fluent licensed premises. MatchMaker scores every requirement against every listing, on the detail that actually decides a leisure deal.",
    url: "https://crm.getbrian.xyz",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "CRM, built by Brian — for UK leisure property agents",
    images: ["/og-image.png"],
  },
  // The masterbrand icon set, same files and paths as www.getbrian.xyz.
  // public/favicon.ico is served at /favicon.ico for the Vercel project tile.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

// Applies the saved/system theme before paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${headingFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
