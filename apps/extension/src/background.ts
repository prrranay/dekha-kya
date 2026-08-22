import { API_BASE_URL, FRONTEND_URL } from './config';

console.log('Dekha Kya? Tracker Service Worker Active.');

interface ExtensionMessage {
  type: string;
  payload?: any;
  token?: string;
}

interface ExtensionResponse {
  success: boolean;
  data?: any;
  error?: string;
  frontendUrl?: string;
}

// Helper to get a valid Extension JWT, requesting a handoff from the dashboard if expired
async function getValidToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['extensionToken', 'tokenExpiry'], async (result) => {
      const token = result.extensionToken;
      const expiry = result.tokenExpiry;
      const now = Date.now();

      if (token && expiry && now < expiry) {
        resolve(token);
      } else {
        console.log('[BACKGROUND] Extension token missing or expired. Requesting handoff from dashboard...');
        const requested = await requestHandoffFromDashboard();
        if (requested) {
          // Wait briefly to allow handoff message exchange to complete
          setTimeout(() => {
            chrome.storage.local.get(['extensionToken'], (res2) => {
              resolve(res2.extensionToken || null);
            });
          }, 1500);
        } else {
          resolve(null);
        }
      }
    });
  });
}

// Request any active dashboard tab to fetch a new handoff token
async function requestHandoffFromDashboard(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      let requested = false;
      for (const tab of tabs) {
        if (tab.id && tab.url && (tab.url.includes('localhost:3000') || tab.url.includes('vercel.app') || tab.url.includes('ngrok-free.dev'))) {
          chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_NEW_HANDOFF' }).catch(() => {});
          requested = true;
        }
      }
      resolve(requested);
    });
  });
}

// Helper to wrap API calls with Bearer authentication and one-time 401 retry
async function fetchWithAuth(url: string, options: RequestInit = {}, retryCount = 0): Promise<Response> {
  const token = await getValidToken();
  const headers = {
    ...(options.headers || {}),
    'Accept': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && retryCount < 1) {
    console.warn('[BACKGROUND] Bearer token rejected with 401. Revoking token and retrying...');
    await new Promise<void>((resolve) => {
      chrome.storage.local.remove(['extensionToken', 'tokenExpiry'], () => resolve());
    });
    return fetchWithAuth(url, options, retryCount + 1);
  }

  return res;
}

// Listen for message events from content scripts
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionResponse) => void
  ): boolean => {
    if (message.type === 'GET_FRONTEND_URL') {
      sendResponse({ success: true, frontendUrl: FRONTEND_URL });
      return true;
    }

    if (message.type === 'SAVE_HANDOFF_TOKEN') {
      const token = message.payload?.token || message.token;
      if (!token) {
        sendResponse({ success: false, error: 'Handoff token missing' });
        return true;
      }

      console.log('[BACKGROUND] Exchanging handoff token for extension access JWT...');
      fetch(`${API_BASE_URL}/auth/extension/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ handoffToken: token }),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Token exchange failed with status: ${res.status}`);
          }
          const data = await res.json();
          chrome.storage.local.set({
            extensionToken: data.accessToken,
            tokenExpiry: data.expiresAt,
          }, () => {
            console.log('[BACKGROUND] Extension token successfully stored.');
            sendResponse({ success: true });
          });
        })
        .catch((err: Error) => {
          console.error('[BACKGROUND] Token exchange error:', err);
          sendResponse({ success: false, error: err.message });
        });

      return true;
    }

    if (message.type === 'GET_AUTH_STATUS') {
      fetchWithAuth(`${API_BASE_URL}/auth/status`, { method: 'GET' })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP error. Status: ${response.status}`);
          }
          const data = await response.json();
          sendResponse({ success: true, data });
        })
        .catch((error: Error) => {
          console.error('Failed to get auth status:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true;
    }

    if (message.type === 'GET_LATEST_ACTIVITY') {
      fetchWithAuth(`${API_BASE_URL}/dashboard/stats`, { method: 'GET' })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP error. Status: ${response.status}`);
          }
          const data = await response.json();
          sendResponse({ success: true, data: data.recentEvents || [] });
        })
        .catch((error: Error) => {
          console.error('Failed to get latest activity:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true;
    }

    if (message.type === 'OPEN_OAUTH_TAB') {
      chrome.tabs.create({ url: `${API_BASE_URL}/auth/google` });
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'SEND_TRACKED_EMAIL') {
      const payload = message.payload;
      console.log('Forwarding tracked email payload to backend to split and send:', payload);

      fetchWithAuth(`${API_BASE_URL}/gmail/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
        .then(async (response) => {
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server returned error: ${errText}`);
          }
          const data = await response.json();
          sendResponse({ success: true, data });
        })
        .catch((error: Error) => {
          console.error('Failed dispatching tracked send to backend:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true;
    }

    return false;
  }
);

// Create alarm on installation for periodic 60s background polling & heartbeat
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('activity-poll', { periodInMinutes: 1 });
  console.log('[BACKGROUND] Created alarm activity-poll.');
  chrome.storage.local.set({ lastSeenEventTime: new Date().toISOString() });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'activity-poll') {
    pollLatestActivity();
    sendHeartbeat();
  }
});

function pollLatestActivity() {
  fetchWithAuth(`${API_BASE_URL}/dashboard/stats`, { method: 'GET' })
    .then((res) => {
      if (!res.ok) throw new Error('API request failed');
      return res.json();
    })
    .then((data) => {
      const events = data.recentEvents || [];
      if (events.length > 0) {
        const latestEvent = events[0];
        
        chrome.storage.local.get(['lastSeenEventTime'], (result) => {
          const lastTime = result.lastSeenEventTime || '';
          
          if (latestEvent.timestamp !== lastTime) {
            chrome.storage.local.set({ lastSeenEventTime: latestEvent.timestamp });
            
            chrome.notifications.create(`open-${Date.now()}`, {
              type: 'basic',
              iconUrl: 'logo.png',
              title: latestEvent.subject || 'Email Opened',
              message: `✓✓ ${latestEvent.recipientEmail} has just read your email`,
              priority: 2
            });
            
            chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
              tabs.forEach((tab) => {
                if (tab.id) {
                  chrome.tabs.sendMessage(tab.id, { type: 'NEW_ACTIVITY_LOGGED' }).catch(() => {});
                }
              });
            });
          }
        });
      }
    })
    .catch((err) => console.error('[BACKGROUND_POLL] Error polling latest activity:', err));
}

function sendHeartbeat() {
  getValidToken().then((token) => {
    if (!token) return;

    fetch(`${API_BASE_URL}/auth/extension/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        browser: 'Chrome',
        version: '1.0.0',
      }),
    })
      .then((res) => {
        if (!res.ok) {
          console.warn('[BACKGROUND] Heartbeat rejected by API:', res.status);
        }
      })
      .catch((err) => console.error('[BACKGROUND] Heartbeat request failed:', err));
  });
}

