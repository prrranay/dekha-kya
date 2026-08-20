'use client';

import React from 'react';
import { Mail, MailOpen, Eye, ArrowUpRight, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

interface RecentEvent {
  id: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  timestamp: string;
  category: 'RECIPIENT_OPEN' | 'SELF_OPEN' | 'UNKNOWN_OPEN';
}

interface StatsData {
  totalTracked: number;
  openedEmails: number;
  totalDetectedOpens: number;
  recentEvents: RecentEvent[];
}

const API_BASE_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;

const fetchDashboardStats = async (): Promise<StatsData> => {
  const res = await fetch(`${API_BASE_URL}/dashboard/stats`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error('Failed to retrieve dashboard stats');
  }
  return res.json();
};

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery<StatsData>({
    queryKey: ['dashboardStats'],
    queryFn: fetchDashboardStats,
    refetchInterval: 5000, // Poll every 5 seconds for live activity logs
  });

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Dashboard</h2>
          <p className="text-sm text-zinc-500">Retrieving email telemetry...</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="bg-white p-6 rounded-xl border border-zinc-200 animate-pulse h-32" />
          ))}
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl p-6 h-64 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center gap-3 text-red-800">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <div>
          <h4 className="font-bold text-sm">Failed to connect to backend server</h4>
          <p className="text-xs mt-1 text-red-600">
            Please check that your NestJS API server is running on port 4000 and try again.
          </p>
        </div>
      </div>
    );
  }

  // Format stats for display
  const STATS = [
    {
      name: 'Total tracked emails',
      value: data.totalTracked.toString(),
      icon: Mail,
      color: 'text-indigo-600 bg-indigo-50',
      description: 'Emails sent with active tracking pixels',
    },
    {
      name: 'Emails opened',
      value: data.openedEmails.toString(),
      icon: MailOpen,
      color: 'text-emerald-600 bg-emerald-50',
      description: 'At least one recipient opened the email',
    },
    {
      name: 'Total detected opens',
      value: data.totalDetectedOpens.toString(),
      icon: Eye,
      color: 'text-amber-600 bg-amber-50',
      description: 'Aggregated opens across all recipients',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Dashboard</h2>
          <p className="text-sm text-zinc-500">Real-time stats and interaction updates for your outbound communications.</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Live updates active
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {STATS.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div key={idx} className="bg-white p-6 rounded-xl border border-zinc-200/80 card-hover flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{stat.name}</span>
                <span className={`p-2 rounded-lg ${stat.color}`}>
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-3xl font-bold text-zinc-900 tracking-tight">{stat.value}</h3>
                <p className="text-xs text-zinc-400 mt-1">{stat.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Sections */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Recently Opened (Takes 2 columns) */}
        <div className="bg-white border border-zinc-200/80 rounded-xl md:col-span-2 flex flex-col justify-between overflow-hidden">
          <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-zinc-950">Recently Active</h3>
              <p className="text-xs text-zinc-500">Live feed of recipient interaction events.</p>
            </div>
            <Link href="/emails" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-premium">
              View All <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="divide-y divide-zinc-100">
            {data.recentEvents.map((open) => {
              const dateText = new Date(open.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div key={open.id} className="p-6 flex items-center justify-between hover:bg-zinc-50/50 transition-premium">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-zinc-50 flex items-center justify-center border border-zinc-100">
                      <Clock className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-900">{open.subject}</h4>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Opened by <span className="font-medium text-zinc-700">{open.recipientName}</span> ({open.recipientEmail})
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                      Detected open
                    </span>
                    <p className="text-[10px] text-zinc-400 mt-1">{dateText}</p>
                  </div>
                </div>
              );
            })}

            {data.recentEvents.length === 0 && (
              <div className="p-12 text-center text-zinc-400 italic text-xs">
                No tracking events detected yet.
              </div>
            )}
          </div>
        </div>

        {/* Quick Tips / Integration Health (Takes 1 column) */}
        <div className="bg-white border border-zinc-200/80 rounded-xl p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-950">Integration Health</h3>
              <p className="text-xs text-zinc-500">Current connection parameters.</p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs border-b border-zinc-100 pb-2">
                <span className="text-zinc-500">Chrome Extension</span>
                <span className="font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Active</span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-zinc-100 pb-2">
                <span className="text-zinc-500">Gmail API Status</span>
                <span className="font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Synchronized</span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-zinc-100 pb-2">
                <span className="text-zinc-500">Encryption Method</span>
                <span className="font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">AES-256-CBC</span>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-zinc-50 border border-zinc-200/60 p-4 rounded-lg">
            <h4 className="text-xs font-bold text-zinc-800">Terminological Accuracy</h4>
            <p className="text-[11px] leading-relaxed text-zinc-500 mt-1">
              "Detected opens" displays events logged from tracking pixels. Note that client proxy servers or previews may trigger false positives.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
