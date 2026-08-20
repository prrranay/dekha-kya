const API_BASE_URL = 'http://localhost:4000/api';

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
