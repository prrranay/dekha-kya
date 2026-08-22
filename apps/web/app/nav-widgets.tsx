'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Loader2, LogOut, Bell, Clock, MailOpen } from 'lucide-react';

const API_BASE_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;

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
        href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/auth/logout`}
        title="Logout"
        className="p-1.5 text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-all"
      >
        <LogOut className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const { data: stats } = useQuery<any>({
    queryKey: ['dashboardStats'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/dashboard/stats`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      return res.json();
    },
    staleTime: 5000,
  });

  const events = stats?.recentEvents || [];

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-zinc-500 hover:text-indigo-650 rounded-lg hover:bg-zinc-100 transition-all relative"
      >
        <Bell className="w-4 h-4" />
        {events.length > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="p-4 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
            <h4 className="text-xs font-bold text-zinc-800">Recent Email Activity</h4>
            <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-full">
              {events.length} events
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-zinc-100">
            {events.length === 0 ? (
              <div className="p-6 text-center text-zinc-400">
                <MailOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-[11px]">No recent email activity detected.</p>
              </div>
            ) : (
              events.map((e: any) => (
                <div key={e.id} className="p-3 hover:bg-zinc-50 transition-colors">
                  <div className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-605 text-[10px] font-bold shrink-0 mt-0.5">
                      {e.recipientEmail.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-zinc-700 font-medium leading-tight">
                        <span className="font-bold text-zinc-950">{e.recipientEmail}</span> opened your email
                      </p>
                      <p className="text-[10px] text-zinc-500 truncate mt-0.5">Subject: {e.subject}</p>
                      <p className="text-[9px] text-zinc-400 flex items-center gap-1 mt-1 font-medium">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
