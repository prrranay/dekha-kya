'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Loader2, LogOut } from 'lucide-react';

interface UserSession {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  gmailConnected: boolean;
}

export function ApiLinkStatus() {
  const { data: user } = useQuery<UserSession>({
    queryKey: ['me'],
  });

  const isConnected = user?.gmailConnected;

  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-emerald-600" />
        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
          Gmail Link Active
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <ShieldAlert className="w-5 h-5 text-amber-500 animate-bounce" />
      <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 animate-pulse">
        Gmail Link Required
      </span>
    </div>
  );
}

export function UserFooter() {
  const { data: user } = useQuery<UserSession>({
    queryKey: ['me'],
  });

  if (!user) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
        <span className="text-[10px] text-zinc-500">Loading user profile...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <img
        src={user.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80'}
        alt={user.name}
        className="w-9 h-9 rounded-full border border-zinc-200"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-zinc-800 truncate">{user.name}</p>
        <p className="text-[10px] text-zinc-500 truncate">{user.email}</p>
      </div>
      <a
        href="http://localhost:4000/api/auth/logout"
        title="Logout"
        className="p-1.5 text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-all"
      >
        <LogOut className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}
