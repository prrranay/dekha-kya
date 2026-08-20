import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import Link from 'next/link';
import { LayoutDashboard, Mail, Settings, Bell } from 'lucide-react';
import { ApiLinkStatus, UserFooter } from './nav-widgets';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Dekha Kya? - Gmail Email Tracker',
  description: 'Production-quality, recipient-level email tracking for Gmail',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${outfit.variable} font-sans antialiased`}>
      <body className="flex h-screen bg-[#f8fafc]">
        <Providers>
          {/* Sidebar */}
          <aside className="w-64 border-r border-zinc-200 bg-white flex flex-col justify-between shrink-0">
            <div>
              {/* Logo / Brand Header */}
              <div className="h-16 flex items-center px-6 border-b border-zinc-100 gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                  D
                </div>
                <div>
                  <h1 className="text-sm font-semibold tracking-tight text-zinc-900 leading-none">Dekha Kya?</h1>
                  <span className="text-[10px] text-zinc-500 font-medium tracking-wide uppercase">Gmail Tracker</span>
                </div>
              </div>

              {/* Navigation Links */}
              <nav className="p-4 space-y-1">
                <Link
                  href="/"
                  className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-zinc-700 hover:text-indigo-600 rounded-lg hover:bg-zinc-50 transition-premium"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
                <Link
                  href="/emails"
                  className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-zinc-700 hover:text-indigo-600 rounded-lg hover:bg-zinc-50 transition-premium"
                >
                  <Mail className="w-4 h-4" />
                  Tracked Emails
                </Link>
                <Link
                  href="/settings"
                  className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-zinc-700 hover:text-indigo-600 rounded-lg hover:bg-zinc-50 transition-premium"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
              </nav>
            </div>

            {/* User Footer context / Status */}
            <div className="p-4 border-t border-zinc-100 bg-zinc-50/50">
              <UserFooter />
            </div>
          </aside>

          {/* Main Content Workspace */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Topbar / Header */}
            <header className="h-16 bg-white border-b border-zinc-200 flex items-center justify-between px-8 shrink-0">
              <ApiLinkStatus />
              <div className="flex items-center gap-4">
                <button className="p-2 text-zinc-500 hover:text-zinc-700 rounded-lg hover:bg-zinc-100 transition-premium relative">
                  <Bell className="w-4 h-4" />
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-600"></span>
                </button>
              </div>
            </header>

            {/* Page Content */}
            <main className="flex-1 overflow-y-auto p-8">
              <div className="max-w-6xl mx-auto space-y-8">
                {children}
              </div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
