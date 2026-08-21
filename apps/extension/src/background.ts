const API_BASE_URL = 'https://dekha-kya.up.railway.app/api';

console.log('Dekha Kya? Tracker Service Worker Active.');

interface ExtensionMessage {
  type: string;
  payload?: any;
}

interface ExtensionResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Listen for message events from content scripts (running in Gmail context)
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionResponse) => void
  ): boolean => {
    if (message.type === 'GET_AUTH_STATUS') {
      fetch(`${API_BASE_URL}/auth/status`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      })
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
      fetch(`${API_BASE_URL}/dashboard/stats`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      })
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

      fetch(`${API_BASE_URL}/gmail/send`, {
        method: 'POST',
        credentials: 'include',
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

// 1. Create alarm on installation for periodic 60s background polling
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('activity-poll', { periodInMinutes: 1 });
  console.log('[BACKGROUND] Created alarm activity-poll.');
  
  // Set initial check time to avoid spamming historical opens on install
  chrome.storage.local.set({ lastSeenEventTime: new Date().toISOString() });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'activity-poll') {
    pollLatestActivity();
  }
});

/**
 * Polls the backend API for the latest tracking events.
 * Triggers a desktop notification and notifies active Gmail tabs if a new open is discovered.
 */
function pollLatestActivity() {
  fetch(`${API_BASE_URL}/dashboard/stats`, {
    method: 'GET',
    credentials: 'include',
  })
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
          
          // Trigger notification only if the event is newer
          if (latestEvent.openedAt !== lastTime) {
            chrome.storage.local.set({ lastSeenEventTime: latestEvent.openedAt });
            
            // Create Desktop Notification
            chrome.notifications.create(`open-${Date.now()}`, {
              type: 'basic',
              iconUrl: 'logo.png',
              title: latestEvent.subject || 'Email Opened',
              message: `✓✓ ${latestEvent.recipientEmail} has just read your email`,
              priority: 2
            });
            
            // Broadcast message to content script in Gmail to show the red dot badge in Gmail UI
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
