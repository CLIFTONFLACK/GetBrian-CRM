import type { Metadata } from "next";
import { DM_Sans, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

/* Brand type, per the GetBrian field guide (v3): Space Grotesk sets headings,
   DM Sans sets body copy. Mono is unspecified by the brand and stays Geist. */
const headingFont = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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
  title: {
    default: "CRM by GetBrian — CRM — UK Leisure Property Agents",
    template: "%s · CRM by GetBrian",
  },
  description:
    "The CRM that speaks fluent licensed premises. Track operators, landlords and listings, and let MatchMaker score every requirement against every listing. Built by Brian.",
  openGraph: {
    type: "website",
    siteName: "CRM by GetBrian",
    title: "CRM by GetBrian — CRM — UK Leisure Property Agents",
    description:
      "The CRM that speaks fluent licensed premises. MatchMaker scores every requirement against every listing, on the detail that actually decides a leisure deal.",
    images: ["/brand/og-image.png"],
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
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
