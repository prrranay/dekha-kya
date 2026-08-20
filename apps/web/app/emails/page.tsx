'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Clock,
  Calendar,
  EyeOff,
  User,
  X,
  ChevronRight,
  MessageSquare,
  Filter,
  AlertTriangle,
  Loader2,
  Activity,
  Maximize2
} from 'lucide-react';

interface ThreadSummary {
  id: string;
  subject: string;
  gmailThreadId: string;
  sentDate: string;
  lastActivity: string | null;
  openCount: number;
  totalRecipients: number;
  status: 'Opened' | 'Unopened' | 'Partial';
  messagesCount: number;
}

interface RecipientTracking {
  id: string;
  email: string;
  displayName: string | null;
  recipientType: 'TO' | 'CC' | 'BCC';
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
}

interface OutgoingMessage {
  id: string;
  gmailMessageId: string;
  subject: string;
  sentAt: string;
  direction: 'INBOUND' | 'OUTBOUND';
  recipients: RecipientTracking[];
}

interface ThreadDetails {
  id: string;
  gmailThreadId: string;
  subject: string;
  totalRecipients: number;
  openCount: number;
  lastActivity: string | null;
  messages: OutgoingMessage[];
}

interface RecipientEvent {
  id: string;
  type: string;
  category: string;
  timestamp: string;
  userAgent: string | null;
  referer: string | null;
}

interface RecipientDetails {
  recipientId: string;
  email: string;
  displayName: string | null;
  events: RecipientEvent[];
}

const API_BASE_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;

export default function TrackedEmailsPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'opened' | 'not-detected'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 1. Fetch Threads matching queries
  const { data: threads, isLoading: isThreadsLoading, error: threadsError } = useQuery<ThreadSummary[]>({
    queryKey: ['threads', searchQuery, statusFilter, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const res = await fetch(`${API_BASE_URL}/threads?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to retrieve threads');
      return res.json();
    },
    refetchInterval: 5000,
  });

  // 2. Fetch specific thread details when selected
  const { data: threadDetails, isLoading: isDetailsLoading } = useQuery<ThreadDetails>({
    queryKey: ['threadDetails', selectedThreadId],
    queryFn: async () => {
      if (!selectedThreadId) return null;
      const res = await fetch(`${API_BASE_URL}/threads/${selectedThreadId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to retrieve thread details');
      return res.json();
    },
    enabled: !!selectedThreadId,
  });

  // 3. Fetch recipient open history events when selected
  const { data: recipientDetails, isLoading: isRecipientLoading } = useQuery<RecipientDetails>({
    queryKey: ['recipientDetails', selectedRecipientId],
    queryFn: async () => {
      if (!selectedRecipientId) return null;
      const res = await fetch(`${API_BASE_URL}/recipients/${selectedRecipientId}/events`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to retrieve recipient events');
      return res.json();
    },
    enabled: !!selectedRecipientId,
  });

  return (
    <div className="relative min-h-[calc(100vh-10rem)]">
      {/* Page Header & Filtering Controls */}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Tracked Emails</h2>
          <p className="text-sm text-zinc-500">Track and review opens across threads, messages, and individual recipients.</p>
        </div>

        {/* Filters Panel */}
        <div className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded-xl border border-zinc-200/80 shadow-sm">
          {/* Search Subject/Recipients */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search subject or recipient..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 transition-premium"
            />
          </div>

          {/* Status Dropdown */}
          <div className="relative w-full md:w-48">
            <select
              value={statusFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value as 'all' | 'opened' | 'not-detected')}
              className="w-full pl-3 pr-8 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 transition-premium"
            >
              <option value="all">All statuses</option>
              <option value="opened">Detected opens</option>
              <option value="not-detected">Not detected</option>
            </select>
            <Filter className="absolute right-3 top-2.5 h-4 w-4 text-zinc-400 pointer-events-none" />
          </div>

          {/* Date Picker Range */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="pl-3 pr-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
            <span className="text-zinc-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="pl-3 pr-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
        </div>
      </div>

      {/* Main Table Content */}
      {threadsError ? (
        <div className="mt-8 bg-red-50 border border-red-200 rounded-xl p-6 flex items-center gap-3 text-red-800">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <h4 className="font-bold text-sm">Failed to connect to backend server</h4>
            <p className="text-xs mt-1 text-red-600">Ensure the NestJS API is operational.</p>
          </div>
        </div>
      ) : isThreadsLoading ? (
        <div className="mt-8 bg-white border border-zinc-200/80 rounded-xl overflow-hidden animate-pulse">
          <div className="h-12 bg-zinc-50 border-b border-zinc-100" />
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-16 border-b border-zinc-100 bg-white" />
          ))}
        </div>
      ) : (
        <div className="mt-8 bg-white border border-zinc-200/80 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/50">
                  <th className="px-6 py-4 font-semibold text-zinc-600">Subject</th>
                  <th className="px-6 py-4 font-semibold text-zinc-600">Recipients Count</th>
                  <th className="px-6 py-4 font-semibold text-zinc-600">Last activity</th>
                  <th className="px-6 py-4 font-semibold text-zinc-600">Open status</th>
                  <th className="px-6 py-4 font-semibold text-zinc-600">Sent date</th>
                  <th className="px-6 py-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {threads?.map((thread) => {
                  const sentDateText = new Date(thread.sentDate).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  });

                  const activityText = thread.lastActivity
                    ? new Date(thread.lastActivity).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Not detected';

                  return (
                    <tr
                      key={thread.id}
                      onClick={() => setSelectedThreadId(thread.id)}
                      className={`hover:bg-zinc-50/70 cursor-pointer transition-premium ${
                        selectedThreadId === thread.id ? 'bg-indigo-50/20' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="font-semibold text-zinc-900 flex items-center gap-2">
                          {thread.subject}
                          {thread.messagesCount > 1 && (
                            <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <MessageSquare className="w-2.5 h-2.5" />
                              {thread.messagesCount} messages
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-zinc-500 font-medium">
                        {thread.totalRecipients} recipient{thread.totalRecipients > 1 ? 's' : ''}
                      </td>
                      <td className="px-6 py-4 text-zinc-500">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-zinc-400" />
                          {activityText}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {thread.status === 'Opened' && (
                          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
                            {thread.openCount} detected opens
                          </span>
                        )}
                        {thread.status === 'Partial' && (
                          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">
                            {thread.openCount} detected opens
                          </span>
                        )}
                        {thread.status === 'Unopened' && (
                          <span className="text-xs font-semibold text-zinc-500 bg-zinc-50 border border-zinc-100 px-2.5 py-1 rounded-full">
                            Not detected
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-zinc-500">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                          {sentDateText}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <ChevronRight className="w-4 h-4 text-zinc-400 ml-auto" />
                      </td>
                    </tr>
                  );
                })}

                {threads?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="max-w-sm mx-auto">
                        <div className="w-12 h-12 rounded-full bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
                          <EyeOff className="w-5 h-5 text-zinc-400" />
                        </div>
                        <h3 className="text-sm font-bold text-zinc-900">No tracked emails found</h3>
                        <p className="text-xs text-zinc-500 mt-1">
                          No tracking event has been received matching these filter criteria.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Slide-over Drawer Backdrops */}
      {(selectedThreadId || selectedRecipientId) && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity"
          onClick={() => {
            if (selectedRecipientId) {
              setSelectedRecipientId(null);
            } else {
              setSelectedThreadId(null);
            }
          }}
        />
      )}

      {/* 1. Main Thread Detail Drawer */}
      <div
        className={`fixed top-0 right-0 h-screen w-full sm:w-[540px] bg-white border-l border-zinc-200 shadow-2xl z-40 transform transition-transform duration-300 ease-in-out flex flex-col ${
          selectedThreadId ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {selectedThreadId && (
          <>
            {/* Header */}
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div className="min-w-0">
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  Conversation Thread
                </span>
                <h3 className="text-base font-bold text-zinc-950 truncate pr-4">
                  {threadDetails?.subject || 'Retrieving...'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedThreadId(null)}
                className="p-1 text-zinc-400 hover:text-zinc-600 rounded-lg hover:bg-zinc-100 transition-premium shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Details Content */}
            {isDetailsLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Aggregated Thread Statistics */}
                <div className="bg-indigo-50/30 border border-indigo-100 p-4 rounded-xl space-y-3">
                  <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider">
                    Thread Aggregated Metrics
                  </h4>
                  <div className="grid grid-cols-3 gap-2 text-center pt-1">
                    <div className="bg-white p-2 rounded-lg border border-indigo-100">
                      <span className="text-[10px] text-zinc-400 font-medium">Recipients</span>
                      <p className="text-sm font-bold text-zinc-800">{threadDetails?.totalRecipients}</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-indigo-100">
                      <span className="text-[10px] text-zinc-400 font-medium">Detected opens</span>
                      <p className="text-sm font-bold text-indigo-800">{threadDetails?.openCount}</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-indigo-100">
                      <span className="text-[10px] text-zinc-400 font-medium">Last active</span>
                      <p className="text-sm font-bold text-zinc-800 truncate">
                        {threadDetails?.lastActivity
                          ? new Date(threadDetails.lastActivity).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'None'}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-indigo-700/80 leading-relaxed italic text-center">
                    Note: Metrics represent aggregates across all tracked outgoing messages.
                  </p>
                </div>

                {/* Conversation Timeline */}
                <div className="space-y-6">
                  <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">
                    Outgoing Messages Timeline
                  </h4>

                  {threadDetails?.messages.map((message, index) => {
                    const messageDateText = new Date(message.sentAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div key={message.id} className="border border-zinc-200 rounded-xl overflow-hidden bg-white shadow-sm">
                        {/* Message Header */}
                        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-zinc-800">
                              Message #{index + 1}
                            </span>
                            <p className="text-[10px] text-zinc-500">Sent: {messageDateText}</p>
                          </div>
                          <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                            {message.direction}
                          </span>
                        </div>

                        {/* Recipient Rows */}
                        <div className="divide-y divide-zinc-100">
                          {message.recipients.map((recipient) => (
                            <div
                              key={recipient.id}
                              onClick={() => setSelectedRecipientId(recipient.id)}
                              className="p-4 flex justify-between items-center hover:bg-zinc-50/70 cursor-pointer transition-premium group"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-zinc-800 flex items-center gap-1.5 truncate">
                                  <User className="w-3.5 h-3.5 text-zinc-400" />
                                  {recipient.displayName || recipient.email}
                                  <span className="text-[9px] font-bold px-1.5 py-0.2 bg-zinc-100 text-zinc-500 rounded">
                                    {recipient.recipientType}
                                  </span>
                                </p>
                                <p className="text-[10px] text-zinc-400 mt-0.5 ml-5 truncate">
                                  {recipient.email}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {recipient.openCount > 0 ? (
                                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                                    {recipient.openCount} detected opens
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium text-zinc-400 bg-zinc-50 border border-zinc-200/50 px-2 py-0.5 rounded-full">
                                    Not detected
                                  </span>
                                )}
                                <Maximize2 className="w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {threadDetails?.messages.length === 0 && (
                    <div className="text-center text-zinc-400 italic text-xs py-8">
                      No tracked outgoing messages in this conversation.
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 2. Secondary Recipient Event History Slide-over Drawer */}
      <div
        className={`fixed top-0 right-0 h-screen w-full sm:w-[480px] bg-white border-l border-zinc-200 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          selectedRecipientId ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {selectedRecipientId && (
          <>
            {/* Header */}
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div className="min-w-0">
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  Recipient Open Log
                </span>
                <h3 className="text-base font-bold text-zinc-950 truncate">
                  {recipientDetails?.displayName || recipientDetails?.email || 'Loading...'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedRecipientId(null)}
                className="p-1 text-zinc-400 hover:text-zinc-600 rounded-lg hover:bg-zinc-100 transition-premium shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content list */}
            {isRecipientLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="bg-zinc-50 border border-zinc-200/60 p-4 rounded-xl space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Email Address</span>
                    <span className="font-semibold text-zinc-800">{recipientDetails?.email}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Total detected opens</span>
                    <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      {recipientDetails?.events.length || 0} opens
                    </span>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-zinc-400" />
                    Open Event Timeline
                  </h4>

                  <div className="relative border-l border-zinc-100 pl-4 ml-2 space-y-6 pt-2">
                    {recipientDetails?.events.map((event) => {
                      const timeStr = new Date(event.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      const dateStr = new Date(event.timestamp).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      });

                      return (
                        <div key={event.id} className="relative">
                          {/* Dot marker */}
                          <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white shadow-sm" />
                          <div className="text-xs">
                            <span className="font-semibold text-zinc-900">Detected open</span>
                            <span className="text-zinc-400 text-[10px] ml-2">
                              {dateStr} at {timeStr}
                            </span>
                            {event.userAgent && (
                              <p className="text-[10px] text-zinc-500 font-mono mt-1 bg-zinc-50 p-2 rounded border border-zinc-200/50 leading-relaxed truncate">
                                {event.userAgent}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {recipientDetails?.events.length === 0 && (
                      <div className="p-4 text-center text-zinc-400 italic text-xs">
                        No tracking event has been received.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
