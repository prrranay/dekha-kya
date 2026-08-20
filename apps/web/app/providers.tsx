'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Lock, Eye, CheckCircle2, Loader2 } from 'lucide-react';

const API_BASE_URL = 'http://localhost:4000/api';

// Full Screen Google Login Gate Page Component
function SessionGate({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Unauthorized');
      }
      return res.json();
    },
    retry: false,
  });

  const handleLogin = () => {
    // Redirect browser to NestJS backend Google OAuth flow
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-zinc-50/50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-2" />
        <p className="text-xs text-zinc-500 font-medium">Verifying active session...</p>
      </div>
    );
  }

  // 2. Unauthenticated / Sign-in Gate State
  if (isError || !user) {
    return (
      <div className="min-h-screen w-screen bg-[#09090b] text-zinc-50 flex items-center justify-center p-4 selection:bg-indigo-500/30 font-sans">
        {/* Decorative background gradients */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
          <div className="absolute top-[20%] left-[20%] w-[350px] h-[350px] bg-indigo-600 rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[20%] w-[350px] h-[350px] bg-emerald-600 rounded-full blur-[120px]" />
        </div>

        <div className="relative w-full max-w-md bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-8 backdrop-blur-xl shadow-2xl space-y-8">
          {/* Header & Logo */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-extrabold text-2xl mx-auto shadow-lg shadow-indigo-500/25">
              D
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Sign in to Dekha Kya?</h2>
              <p className="text-xs text-zinc-400 mt-1">Real-time recipient-level Gmail tracking dashboard.</p>
            </div>
          </div>

          {/* Core Feature Highlights */}
          <div className="space-y-4 pt-2">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700/50">
                <Eye className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-zinc-200">Recipient-Level Tracking</h4>
                <p className="text-[10px] text-zinc-400 mt-0.5">Isolates unique tracking pixels for multiple recipients in group emails.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700/50">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-zinc-200">Gmail Conversation Timeline</h4>
                <p className="text-[10px] text-zinc-400 mt-0.5">Tracks consecutive outbound message iterations separately in the same thread.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700/50">
                <Lock className="w-3.5 h-3.5 text-zinc-400" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-zinc-200">Secure AES-256-GCM Encryption</h4>
                <p className="text-[10px] text-zinc-400 mt-0.5">Tokens are encrypted at rest. Email contents are never read or stored.</p>
              </div>
            </div>
          </div>

          {/* Call to Action */}
          <div className="pt-2">
            <button
              onClick={handleLogin}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all duration-200 flex items-center justify-center gap-2 hover:scale-[1.01]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Sign in with Google
            </button>
            <p className="text-[10px] text-zinc-500 text-center mt-3">
              By signing in, you connect your personal Gmail account via secure OAuth.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 3. Authenticated State
  return <>{children}</>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>{children}</SessionGate>
    </QueryClientProvider>
  );
}
