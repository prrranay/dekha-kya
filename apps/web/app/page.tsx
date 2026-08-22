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
  gmailConnected?: boolean;
  extensionLastSeenAt?: string | null;
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

  // Verify active user profile and Gmail connection (cached with 2 minutes staleTime)
  const { data: meData } = useQuery({
    queryKey: ['authMe'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
      if (!res.ok) throw new Error('Unauthorized');
      return res.json();
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: false,
  });

  // Separate API reachability check
  const { data: apiStatusData } = useQuery({
    queryKey: ['apiStatus'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/status`, { credentials: 'include' });
        return { reachable: res.ok };
      } catch (e) {
        return { reachable: false };
      }
    },
    refetchInterval: 30000,
  });

  // Separate Tracking Endpoint health check
  const { data: trackingHealthData } = useQuery({
    queryKey: ['trackingHealth'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tracking/health`);
        return { reachable: res.ok };
      } catch (e) {
        return { reachable: false };
      }
    },
    refetchInterval: 30000,
  });

  const handoffInProgressRef = React.useRef(false);

  // Handoff linkage flow
  React.useEffect(() => {
    const handleHandoff = async () => {
      if (handoffInProgressRef.current) return;
      handoffInProgressRef.current = true;

      try {
        const res = await fetch(`${API_BASE_URL}/auth/extension/handoff`, { method: 'POST', credentials: 'include' });
        if (res.ok) {
          const result = await res.json();
          if (result && result.rawToken) {
            // Dispatch via postMessage to window using configured origin
            window.postMessage(
              { type: 'DEKHA_KYA_HANDOFF', token: result.rawToken },
              window.location.origin
            );
          }
        }
      } catch (e) {
        console.error('Failed to trigger extension handoff:', e);
      } finally {
        handoffInProgressRef.current = false;
      }
    };

    // Listen for events from the extension
    const messageListener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data) return;

      if (data.type === 'DEKHA_KYA_EXTENSION_READY' || data.type === 'DEKHA_KYA_REQUEST_HANDOFF') {
        console.log(`[DASHBOARD] Received ${data.type} from extension. Generating handoff token...`);
        handleHandoff();
      }
    };

    window.addEventListener('message', messageListener);

    // Dispatch ping message on page load in case extension is already loaded
    window.postMessage({ type: 'DEKHA_KYA_PING_EXTENSION' }, window.location.origin);

    return () => window.removeEventListener('message', messageListener);
  }, []);

  const getExtensionStatus = (lastSeenAt: string | undefined | null) => {
    if (!lastSeenAt) return { text: 'Not detected', color: 'text-red-600 bg-red-50' };
    const diffMs = Date.now() - new Date(lastSeenAt).getTime();
    const diffMins = diffMs / 60000;

    if (diffMins < 2) {
      return {
        text: 'Connected',
        color: 'text-emerald-600 bg-emerald-50'
      };
    } else if (diffMins < 10) {
      return {
        text: 'Recently active',
        color: 'text-amber-600 bg-amber-50'
      };
    } else {
      return {
        text: 'Not detected',
        color: 'text-red-600 bg-red-50'
      };
    }
  };

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
      name: 'Emails with detected opens',
      value: data.openedEmails.toString(),
      icon: MailOpen,
      color: 'text-emerald-600 bg-emerald-50',
      description: 'At least one recipient had a detected open',
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
                <span className="text-zinc-500">API Status</span>
                <span className={`font-semibold px-2 py-0.5 rounded-full ${apiStatusData?.reachable ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                  {apiStatusData?.reachable ? 'Reachable' : 'Unreachable'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-zinc-100 pb-2">
                <span className="text-zinc-500">Tracking Endpoint</span>
                <span className={`font-semibold px-2 py-0.5 rounded-full ${trackingHealthData?.reachable ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                  {trackingHealthData?.reachable ? 'Reachable' : 'Unreachable'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-zinc-100 pb-2">
                <span className="text-zinc-500">Gmail API Status</span>
                <span className={`font-semibold px-2 py-0.5 rounded-full ${meData?.gmail?.connected ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                  {meData?.gmail?.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs border-b border-zinc-100 pb-2">
                <span className="text-zinc-500">Chrome Extension</span>
                <span className={`font-semibold px-2 py-0.5 rounded-full ${getExtensionStatus(data?.extensionLastSeenAt).color}`}>
                  {getExtensionStatus(data?.extensionLastSeenAt).text}
                </span>
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

