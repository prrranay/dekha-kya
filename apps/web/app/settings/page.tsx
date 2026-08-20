'use client';

import React, { useState } from 'react';
import { Shield, Key, Eye, HelpCircle, Check, Loader2, Link2, AlertCircle, RefreshCw } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

interface UserSession {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  gmailConnected: boolean;
}

const API_BASE_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;

function SettingsContent() {
  const searchParams = useSearchParams();
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [filterSelf, setFilterSelf] = useState(true);

  const connectedParam = searchParams.get('connected');

  // Fetch current authenticated user session
  const { data: user, isLoading } = useQuery<UserSession>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Not authenticated');
      }
      return res.json();
    },
    retry: false,
  });

  // Sync Gmail Mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/gmail/sync`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Sync failed');
      return res.json();
    },
    onSuccess: () => {
      setSyncStatus('Gmail successfully synchronized.');
      setTimeout(() => setSyncStatus(null), 3000);
    },
    onError: (err: Error) => {
      setSyncStatus(`Sync error: ${err.message}`);
      setTimeout(() => setSyncStatus(null), 3000);
    },
  });

  const handleConnectGmail = () => {
    // Redirect to backend OAuth consent flow
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const handleDisconnect = () => {
    // Clear cookies/session by calling backend or redirecting (here we redirect to connect OAuth)
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const isConnected = user?.gmailConnected;

  // Retrieve the public tracking url domain
  const publicApiUrl = process.env.NEXT_PUBLIC_API_PUBLIC_URL || 'https://your-public-ngrok-domain';

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Settings</h2>
        <p className="text-sm text-zinc-500">Manage your Google integrations, privacy preferences, and tracking settings.</p>
      </div>

      {/* Query Notification banner */}
      {connectedParam === 'true' && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          Gmail account successfully authorized and linked!
        </div>
      )}
      {connectedParam === 'false' && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-800 text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to authenticate Gmail account. Please try again.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left Preferences Panel */}
        <div className="md:col-span-2 space-y-6">
          
          {/* Gmail Connection Card */}
          <div className="bg-white border border-zinc-200/80 rounded-xl p-6 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-600" />
              Gmail Connection
            </h3>
            <p className="text-xs text-zinc-500">
              Dekha Kya? uses Google OAuth to access Gmail API metadata. We never store or inspect email body contents.
            </p>

            {isLoading ? (
              <div className="flex items-center justify-center p-6 bg-zinc-50 rounded-lg border border-zinc-100">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
              </div>
            ) : isConnected && user ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-emerald-50/20 rounded-lg border border-emerald-100/50">
                  <div className="flex items-center gap-3">
                    <img
                      src={user.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80'}
                      alt={user.name}
                      className="w-10 h-10 rounded-full border border-zinc-200"
                    />
                    <div>
                      <p className="text-xs font-bold text-zinc-800">{user.name}</p>
                      <p className="text-[10px] text-zinc-500">{user.email}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                    Connected
                  </span>
                </div>

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    className="px-3 py-1.5 text-xs font-semibold bg-white text-zinc-700 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-premium flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {syncMutation.isPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        Sync Gmail
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleConnectGmail}
                    className="px-3 py-1.5 text-xs font-semibold bg-zinc-50 text-zinc-700 border border-zinc-200 rounded-lg hover:bg-zinc-100 transition-premium"
                  >
                    Reconnect
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100 transition-premium"
                  >
                    Disconnect
                  </button>
                </div>

                {syncStatus && (
                  <p className="text-[10px] font-semibold text-indigo-600 animate-fade-in text-right">{syncStatus}</p>
                )}
              </div>
            ) : (
              <div className="p-6 bg-zinc-50 rounded-lg border border-zinc-200/60 text-center space-y-4">
                <div className="w-10 h-10 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center mx-auto text-zinc-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-800">Not connected</h4>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Please authorize your Gmail account to enable email open tracking.</p>
                </div>
                <button
                  onClick={handleConnectGmail}
                  className="px-4 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-premium"
                >
                  Connect Gmail
                </button>
              </div>
            )}
          </div>

          {/* Privacy & Filtering */}
          <div className="bg-white border border-zinc-200/80 rounded-xl p-6 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <Eye className="w-4 h-4 text-indigo-600" />
              Tracking & Open Verification
            </h3>
            <p className="text-xs text-zinc-500">
              Configure parameters governing tracking pixel logs, self-open verification, and security boundaries.
            </p>

            <div className="space-y-4 pt-2">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <label className="text-xs font-bold text-zinc-800">Filter Self-Opens</label>
                  <p className="text-[11px] text-zinc-500">
                    Ignore tracking queries containing the `sender=true` flag to block opens generated by you.
                  </p>
                </div>
                <button
                  onClick={() => setFilterSelf(!filterSelf)}
                  className={`w-10 h-6 flex items-center rounded-full p-1 cursor-pointer transition-premium ${
                    filterSelf ? 'bg-indigo-600 justify-end' : 'bg-zinc-200 justify-start'
                  }`}
                >
                  <span className="w-4 h-4 bg-white rounded-full shadow-md" />
                </button>
              </div>

              <div className="flex items-start justify-between gap-4 border-t border-zinc-100 pt-4">
                <div className="space-y-0.5">
                  <label className="text-xs font-bold text-zinc-800">Anonymize Recipient IPs</label>
                  <p className="text-[11px] text-zinc-500">
                    Always hash incoming IP addresses prior to matching open categories to preserve recipient privacy.
                  </p>
                </div>
                <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                  <Check className="w-4 h-4 text-emerald-600" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Info Panels */}
        <div className="space-y-6">
          {/* Tracking Endpoint Card */}
          <div className="bg-white border border-zinc-200/80 rounded-xl p-6 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-indigo-600" />
              Tracking Endpoint
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Generated tracking pixels reference this public server URL context. Actual security tokens are hidden.
            </p>
            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200/60 text-[10px] font-mono text-zinc-600 select-all break-all leading-normal">
              {publicApiUrl}/api/tracking/open/...
            </div>
          </div>

          {/* Cryptography Status */}
          <div className="bg-white border border-zinc-200/80 rounded-xl p-6 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-600" />
              Cryptography Status
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              OAuth tokens are encrypted at rest using the AES-256-GCM authenticated cipher.
            </p>
            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200/60 text-[10px] font-mono text-zinc-600">
              Cipher: aes-256-gcm
            </div>
          </div>

          {/* Help Panel */}
          <div className="bg-white border border-zinc-200/80 rounded-xl p-6 space-y-3 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-indigo-600" />
              Need Help?
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Having issues tracking emails? Confirm that your Chrome Extension is active on your current browser profile and that you have enabled third-party image loading.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <React.Suspense fallback={
      <div className="flex items-center justify-center p-12 bg-white border border-zinc-200/80 rounded-xl shadow-sm">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    }>
      <SettingsContent />
    </React.Suspense>
  );
}
