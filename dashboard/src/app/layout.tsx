import type { Metadata } from "next";
import { IBM_Plex_Sans, Sora } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/sidebar";
import { LoadingProvider } from "@/components/loading-provider";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scantrix Dashboard",
  description: "Test Automation Intelligence — Historical audit results, trending risk scores, repo comparison",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`min-h-screen bg-background antialiased ${sora.variable} ${plex.variable}`}>
        <LoadingProvider>
          <div className="flex">
            {/* ── Sidebar navigation ── */}
            <Sidebar />

            {/* ── Page content ── */}
            <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-10">
              <div className="mx-auto max-w-7xl">
                {children}
              </div>
            </main>
          </div>
        </LoadingProvider>
      </body>
    </html>
  );
}
