interface RegisterMessageRecipient {
  email: string;
  recipientType: 'TO' | 'CC' | 'BCC';
  displayName?: string;
}

console.log('Dekha Kya? Gmail tracker content script initialized.');

let frontendUrl = '';

chrome.runtime.sendMessage({ type: 'GET_FRONTEND_URL' }, (res) => {
  if (res && res.success && res.frontendUrl) {
    frontendUrl = res.frontendUrl;
    initializeExtension();
  } else {
    console.error('[DEKHA_KYA] Failed to retrieve frontend configuration from background script.');
  }
});

function isGmailPage(): boolean {
  return window.location.host === 'mail.google.com';
}

function isDekhaKyaFrontend(configuredUrl: string): boolean {
  try {
    const urlObj = new URL(configuredUrl);
    return window.location.origin === urlObj.origin;
  } catch (e) {
    return false;
  }
}

function initializeExtension() {
  if (isGmailPage()) {
    console.log('[DEKHA_KYA] Initializing Gmail integration...');
    // Start observing page for compose window elements
    initComposeObserver();
    // Sweep periodically to ensure any re-rendered compose toolbars are populated
    setInterval(() => {
      document.querySelectorAll('.M9, .aoI').forEach((box) => {
        const toolbar = box.querySelector('.gU.Up, .btC');
        if (toolbar && !toolbar.querySelector('.gmail-tracker-toggle-container')) {
          processedComposeWindows.delete(box);
          setupComposeTracking(box);
        }
      });
    }, 1000);

    // Listen for authentication changes to update compose checkbox status instantly
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'AUTH_STATE_CHANGED') {
        console.log('[CONTENT] Authentication state changed. Refreshing active compose windows...');
        document.querySelectorAll('.M9, .aoI').forEach((box) => {
          const existing = box.querySelector('.gmail-tracker-toggle-container');
          if (existing) {
            existing.remove();
          }
          processedComposeWindows.delete(box);
          setupComposeTracking(box);
        });
      }
    });

    // Inject our brand icon into the Gmail top-right header toolbar
    injectToolbarIcon();
  } else if (isDekhaKyaFrontend(frontendUrl)) {
    console.log('[DEKHA_KYA] Initializing dashboard bridge...');
    document.documentElement.setAttribute('data-dekha-kya-extension', 'true');

    // Send initial ready handshake
    window.postMessage({ type: 'DEKHA_KYA_EXTENSION_READY' }, window.location.origin);

    // Listen for new handoff requests from the extension (e.g. on token expiration)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'REQUEST_NEW_HANDOFF') {
        console.log('[CONTENT] Extension requested new handoff. Forwarding to dashboard...');
        window.postMessage({ type: 'DEKHA_KYA_REQUEST_HANDOFF' }, window.location.origin);
      }
    });

    // Listen for window message handoff from dashboard
    window.addEventListener('message', (event) => {
      try {
        const trustedOrigin = new URL(frontendUrl).origin;
        if (event.origin !== trustedOrigin) return;
      } catch (e) {
        return;
      }
      if (event.source !== window) return;

      const data = event.data;
      if (!data) return;

      if (data.type === 'DEKHA_KYA_HANDOFF') {
        const token = data.token;
        if (token && /^[0-9a-fA-F]{64}$/.test(token)) {
          chrome.runtime.sendMessage({ type: 'SAVE_HANDOFF_TOKEN', token });
        }
      } else if (data.type === 'DEKHA_KYA_PING_EXTENSION') {
        window.postMessage({ type: 'DEKHA_KYA_EXTENSION_READY' }, window.location.origin);
      }
    });
  }
}


// Keep track of active observers to prevent duplicates
const processedComposeWindows = new Set<Element>();

/**
 * Initializes compose window observation.
 */
function initComposeObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            // Find compose windows inside the container
            const composeBoxes = node.querySelectorAll('.M9, .aoI');
            composeBoxes.forEach((box) => setupComposeTracking(box));
          }
        });
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial check for already rendered compose windows
  document.querySelectorAll('.M9, .aoI').forEach((box) => setupComposeTracking(box));
}

/**
 * Injects UI checkboxes and overrides default send events.
 */
function setupComposeTracking(composeBox: Element) {
  if (processedComposeWindows.has(composeBox)) return;
  processedComposeWindows.add(composeBox);

  console.log('Hooking compose window:', composeBox);

  // Locate the formatting toolbar / send button area
  const toolbar = composeBox.querySelector('.gU.Up, .btC');
  if (!toolbar) {
    // If not rendered yet, retry in a moment
    processedComposeWindows.delete(composeBox);
    setTimeout(() => setupComposeTracking(composeBox), 500);
    return;
  }

  // Prevent duplicate injections inside the toolbar
  if (toolbar.querySelector('.gmail-tracker-toggle-container')) {
    return;
  }

  // Create native-looking tracking toggle container
  const container = document.createElement('div');
  container.className = 'gmail-tracker-toggle-container';
  container.style.display = 'inline-flex';
  container.style.alignItems = 'center';
  container.style.marginLeft = '16px';
  container.style.marginRight = '8px';
  container.style.fontFamily = 'Roboto, Arial, sans-serif';
  container.style.fontSize = '13px';
  container.style.color = '#5f6368';
  container.style.userSelect = 'none';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `track-toggle-${Math.random().toString(36).substr(2, 9)}`;
  checkbox.checked = false; // OFF by default
  checkbox.style.marginRight = '8px';
  checkbox.style.accentColor = '#4f46e5';
  checkbox.style.cursor = 'pointer';
  checkbox.style.width = '15px';
  checkbox.style.height = '15px';

  const label = document.createElement('label');
  label.htmlFor = checkbox.id;
  label.innerText = 'Track email';
  label.style.cursor = 'pointer';
  label.style.fontWeight = '500';

  const statusSpan = document.createElement('span');
  statusSpan.style.marginLeft = '6px';
  statusSpan.style.fontSize = '11px';
  statusSpan.style.color = '#71717a';

  container.appendChild(checkbox);
  container.appendChild(label);
  container.appendChild(statusSpan);
  toolbar.appendChild(container);

  // Query authenticated status from backend
  chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (res) => {
    const activeGmailEmail = getCurrentGmailAddress();
    const connectedEmail = res && res.success && res.data && res.data.authenticated ? res.data.email : null;

    console.log('[GMAIL_TRACKER] Active Gmail page email:', activeGmailEmail);
    console.log('[GMAIL_TRACKER] Connected extension email:', connectedEmail);

    const isMatching = !activeGmailEmail || !connectedEmail || activeGmailEmail.toLowerCase() === connectedEmail.toLowerCase();

    if (connectedEmail && isMatching) {
      statusSpan.innerHTML = `(<span style="color:#16a34a;font-weight:600;">✓</span> Connected: ${connectedEmail})`;
      checkbox.disabled = false;
      
      // Load toggle state from extension storage settings
      chrome.storage.local.get(['trackingEnabled'], (result) => {
        checkbox.checked = result.trackingEnabled === true;
      });

      container.style.display = 'inline-flex';
    } else if (!connectedEmail) {
      statusSpan.innerHTML = `(<a href="#" class="gmail-tracker-connect-link" style="color:#1a73e8;text-decoration:underline;font-weight:600;cursor:pointer;">Connect Gmail</a>)`;
      checkbox.disabled = true;
      checkbox.checked = false;
      container.style.display = 'inline-flex';

      const connectLink = statusSpan.querySelector('.gmail-tracker-connect-link');
      if (connectLink) {
        connectLink.addEventListener('click', (e) => {
          e.preventDefault();
          chrome.runtime.sendMessage({ type: 'OPEN_OAUTH_TAB' });
        });
      }
    } else {
      // Hide the tracking option completely if they don't match or not authenticated
      checkbox.checked = false;
      checkbox.disabled = true;
      container.style.display = 'none';
    }
  });

  // Only hook event listeners ONCE per composeBox
  if (composeBox.getAttribute('data-gmail-tracker-hooked') === 'true') {
    return;
  }
  composeBox.setAttribute('data-gmail-tracker-hooked', 'true');

  // Intercept Send button — block Gmail's native send when tracking is active
  const sendButton = composeBox.querySelector('.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3');
  if (sendButton) {
    // Track whether we're in a tracked-send flow to block all subsequent events
    let isTrackedSendActive = false;

    const blockEvent = (event: Event) => {
      if (isTrackedSendActive || checkbox.checked) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    // Block ALL event types that Gmail might use to trigger send
    // Use capture phase (true) to run BEFORE Gmail's handlers
    sendButton.addEventListener('click', blockEvent, true);
    sendButton.addEventListener('mouseup', blockEvent, true);

    // Main interception on mousedown (capture phase)
    sendButton.addEventListener('mousedown', (event) => {
      if (!checkbox.checked) {
        return; // Let standard untracked Gmail send proceed
      }

      // Stop Gmail from executing standard send
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      isTrackedSendActive = true;

      // Check current auth status before allowing tracked send
      chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, async (res) => {
        if (res && res.success && res.data && res.data.authenticated && res.data.email) {
          await handleTrackedSend(composeBox, res.data.email, checkbox);
        } else {
          alert('Gmail connection expired or not configured. Please click "Connect Gmail" to authorize tracking first.');
          chrome.runtime.sendMessage({ type: 'OPEN_OAUTH_TAB' });
        }
        isTrackedSendActive = false;
      });
    }, true); // capture phase

    // Also block Ctrl+Enter / Cmd+Enter keyboard shortcut for send
    composeBox.addEventListener('keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (checkbox.checked && keyEvent.key === 'Enter' && (keyEvent.ctrlKey || keyEvent.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, async (res) => {
          if (res && res.success && res.data && res.data.authenticated && res.data.email) {
            await handleTrackedSend(composeBox, res.data.email, checkbox);
          } else {
            alert('Gmail connection expired or not configured. Please click "Connect Gmail" to authorize tracking first.');
            chrome.runtime.sendMessage({ type: 'OPEN_OAUTH_TAB' });
          }
        });
      }
    }, true);
  }
}

/**
 * Robust extraction of the currently logged-in Gmail user's email address from the page.
 */
function getCurrentGmailAddress(): string | null {
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/;

  // 1. Check document title (Gmail puts the logged-in email address in the tab title)
  const titleMatch = (document.title || '').match(emailRegex);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].toLowerCase().trim();
  }

  // 2. Fallback: Search the profile/account icon elements
  const profileSelectors = [
    'a[href*="SignOutOptions"]',
    'a[aria-label*="Google Account"]',
    '[aria-label*="@gmail.com"]',
    '[aria-label*="@"]',
    '.gb_A',
    '.gb_B',
    '.gb_d'
  ];

  for (const selector of profileSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const label = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const text = el.textContent || '';

      const match = label.match(emailRegex) || title.match(emailRegex) || text.match(emailRegex);
      if (match && match[1]) {
        return match[1].toLowerCase().trim();
      }
    }
  }

  return null;
}

/**
 * Handles gathering parameters and transmitting tracked emails.
 */
async function handleTrackedSend(composeBox: Element, senderEmail: string, checkbox: HTMLInputElement) {
  console.log('Initiating tracked split-send sequence...');
  console.log('[SENDER] Using authenticated sender email:', senderEmail);

  // 1. Gather final recipient details
  const toEmails = parseFieldRecipients(composeBox, 'to');
  const ccEmails = parseFieldRecipients(composeBox, 'cc');
  const bccEmails = parseFieldRecipients(composeBox, 'bcc');

  const recipients: RegisterMessageRecipient[] = [
    ...toEmails.map((email) => ({ email, recipientType: 'TO' as const })),
    ...ccEmails.map((email) => ({ email, recipientType: 'CC' as const })),
    ...bccEmails.map((email) => ({ email, recipientType: 'BCC' as const })),
  ];

  if (recipients.length === 0) {
    alert("Couldn't detect recipients. Please check the fields and try again.");
    return;
  }

  // 2. Gather subject & body content
  const subjectInput = composeBox.querySelector('input[name="subjectbox"]') as HTMLInputElement;
  const subject = subjectInput ? subjectInput.value : 'No Subject';

  const bodyEditor = composeBox.querySelector('.Am.Al.editable') as HTMLElement;
  const htmlBody = bodyEditor ? bodyEditor.innerHTML : '';
  const plainTextBody = bodyEditor ? bodyEditor.innerText : '';

  // 3. Gather thread details (Check if we are in reply mode)
  let gmailThreadId = resolveGmailThreadId(composeBox);

  const sendPayload = {
    gmailThreadId,
    subject,
    htmlBody,
    plainTextBody,
    recipients,
  };

  console.log('Dispatching send request to service worker payload:', sendPayload);

  // Instantly hide the compose window visually so the user feels an immediate response (0ms lag)
  const composeBoxElement = composeBox as HTMLElement;
  const originalDisplay = composeBoxElement.style.display;
  composeBoxElement.style.display = 'none';

  // Show "Sending message..." toast immediately
  showGmailToast('Sending message...');

  // Send message to background service worker to post to api
  chrome.runtime.sendMessage(
    {
      type: 'SEND_TRACKED_EMAIL',
      payload: sendPayload,
    },
    (response: { success: boolean; data?: any; error?: string } | undefined) => {
      if (response && response.success && response.data && response.data.success) {
        console.log('Tracked email successfully dispatched!');
        
        // Suppress the native "Draft discarded" toast that is triggered by programmatic click
        suppressGmailDiscardToast();

        if (response.data.status === 'partial') {
          const failedEmails = response.data.recipients
            .filter((r: any) => r.sendStatus === 'FAILED')
            .map((r: any) => r.email)
            .join(', ');
          
          showGmailToast(`${response.data.sentCount} of ${response.data.recipients.length} sent. Failed: ${failedEmails}`, [
            { text: 'View message', url: '#sent' },
            { text: 'Dashboard', url: `${frontendUrl}/emails`, target: '_blank' }
          ]);
        } else {
          // Show "Message sent." toast with link to Sent folder and dashboard monitor link
          showGmailToast('Message sent.', [
            { text: 'View message', url: '#sent' },
            { text: 'Monitor reply', url: `${frontendUrl}/emails`, target: '_blank' }
          ]);
        }

        // Keep composeBox hidden so there is no flash while it closes programmatically
        // Close the Gmail compose window programmatically to sync/discard draft
        const closeBtn = composeBox.querySelector('.Ha') || composeBox.querySelector('.og.T-I-atl.L3') || composeBox.querySelector('.og.T-I-J3') || composeBox.querySelector('[data-tooltip*="Discard"]') || composeBox.querySelector('[aria-label*="Discard"]');
        if (closeBtn instanceof HTMLElement) {
          closeBtn.click();
        } else {
          // Fallback UI removal
          composeBox.remove();
        }
      } else {
        const errorMsg = response?.error || (response?.data && response.data.message) || 'Unknown error';
        console.error('Failed sending tracked email:', errorMsg);
        
        // Remove the "Sending..." toast
        const existing = document.querySelector('.custom-gmail-toast');
        if (existing) existing.remove();

        // Restore visibility so the user doesn't lose their draft email
        composeBoxElement.style.display = originalDisplay;

        showFailureModal(
          // Retry action
          () => {
            handleTrackedSend(composeBox, senderEmail, checkbox);
          },
          // Send without tracking action
          () => {
            checkbox.checked = false;
            // Now click the send button again programmatically
            const realSendBtn = composeBox.querySelector('.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3') as HTMLElement;
            if (realSendBtn) {
              realSendBtn.click();
            }
          },
          // Cancel action
          () => {
            // Nothing to do, visibility is already restored
          }
        );
      }
    }
  );
}

/**
 * Shows a Gmail-style toast notification in the bottom-left corner.
 */
function showGmailToast(message: string, links?: Array<{ text: string; url: string; target?: string }>) {
  const existing = document.querySelector('.custom-gmail-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'custom-gmail-toast';
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.left = '24px';
  toast.style.backgroundColor = '#202124';
  toast.style.color = '#f1f3f4';
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = '4px';
  toast.style.boxShadow = '0 3px 5px -1px rgba(0,0,0,0.2), 0 6px 10px 0 rgba(0,0,0,0.14), 0 1px 18px 0 rgba(0,0,0,0.12)';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '20px';
  toast.style.fontFamily = 'Roboto, Arial, sans-serif';
  toast.style.fontSize = '14px';
  toast.style.zIndex = '2147483647';
  toast.style.transition = 'opacity 0.15s ease-in-out';
  toast.style.opacity = '1';

  const textSpan = document.createElement('span');
  textSpan.innerText = message;
  toast.appendChild(textSpan);

  if (links) {
    links.forEach((link) => {
      const actionLink = document.createElement('a');
      actionLink.innerText = link.text;
      actionLink.href = link.url;
      if (link.target) {
        actionLink.target = link.target;
      }
      actionLink.style.color = '#8ab4f8';
      actionLink.style.textDecoration = 'none';
      actionLink.style.fontWeight = 'bold';
      actionLink.style.cursor = 'pointer';
      actionLink.style.fontSize = '14px';
      actionLink.addEventListener('click', () => {
        if (!link.target) {
          toast.remove();
        }
      });
      toast.appendChild(actionLink);
    });
  }

  const closeBtn = document.createElement('span');
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.color = '#9aa0a6';
  closeBtn.style.fontSize = '12px';
  closeBtn.style.fontWeight = 'bold';
  closeBtn.addEventListener('click', () => {
    toast.remove();
  });
  toast.appendChild(closeBtn);

  document.body.appendChild(toast);

  // Auto-remove after 6 seconds unless it's the "Sending..." status toast
  if (message !== 'Sending message...') {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 150);
      }
    }, 6000);
  }
}

/**
 * Temporarily intercepts and suppresses Gmail's native "Draft discarded" toast.
 */
function suppressGmailDiscardToast() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          const text = node.textContent || '';
          if (text.includes('Draft discarded') || text.includes('discarded') || text.includes('Undo')) {
            node.style.display = 'none';
          }
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    observer.disconnect();
  }, 4000);
}

/**
 * Robust extraction of emails from recipient fields.
 */
function parseFieldRecipients(composeBox: Element, fieldName: 'to' | 'cc' | 'bcc'): string[] {
  const emails: string[] = [];

  // 1. Search the specific field container row (handles data-name, name, and aria-labels)
  const fieldContainer = composeBox.querySelector(
    `[data-name="${fieldName}"], [name="${fieldName}"], [aria-label*="${fieldName}"], [aria-label*="${fieldName.toUpperCase()}"]`
  );
  if (fieldContainer) {
    // Extract from visible text content (handles contenteditable elements, active typing inputs, etc.)
    const textContent = (fieldContainer as HTMLElement).innerText || '';
    if (textContent.includes('@')) {
      emails.push(...extractEmailsFromString(textContent));
    }

    // Extract from HTML source (handles span[email] attributes and chip nodes)
    const htmlContent = fieldContainer.innerHTML || '';
    if (htmlContent.includes('@')) {
      emails.push(...extractEmailsFromString(htmlContent));
    }

    // Extract from any child inputs or textareas
    const activeInputs = fieldContainer.querySelectorAll('input, textarea');
    activeInputs.forEach((el) => {
      const val = (el as HTMLInputElement).value;
      if (val && val.includes('@')) {
        emails.push(...extractEmailsFromString(val));
      }
    });
  }

  // 2. Fallback: Search standard input tags across the entire composeBox
  const inputs = composeBox.querySelectorAll(`input[name="${fieldName}"]`);
  inputs.forEach((el) => {
    const val = (el as HTMLInputElement).value;
    if (val && val.includes('@')) {
      emails.push(...extractEmailsFromString(val));
    }
  });

  // 3. Fallback: Search chips/spans anywhere in the compose box matching this container
  if (fieldContainer) {
    const spanWrappers = fieldContainer.querySelectorAll('span[email]');
    spanWrappers.forEach((el) => {
      const email = el.getAttribute('email');
      if (email) emails.push(email.trim().toLowerCase());
    });
  }

  // 4. Ultimate Fallback: For the "TO" field, if no recipients were found anywhere,
  // extract ALL emails from the compose box EXCLUDING the subject box and the body editor!
  if (fieldName === 'to' && emails.length === 0) {
    console.log('[RECIPIENT_PARSER] Running ultimate fallback clone-and-exclude extraction...');
    try {
      const clone = composeBox.cloneNode(true) as HTMLElement;
      
      // Remove subject inputs
      clone.querySelectorAll('input[name="subjectbox"], .aoT').forEach((el) => el.remove());
      // Remove body editor
      clone.querySelectorAll('.Am.Al.editable, [contenteditable="true"], .LW-avf').forEach((el) => el.remove());
      // Remove formatting controls and other buttons to clean up DOM text
      clone.querySelectorAll('.gU.Up, .btC, .oc, .HQ').forEach((el) => el.remove());

      const text = clone.innerText || '';
      const html = clone.innerHTML || '';

      const parsed = [
        ...extractEmailsFromString(text),
        ...extractEmailsFromString(html)
      ];

      parsed.forEach((email) => {
        emails.push(email);
      });
      console.log('[RECIPIENT_PARSER] Ultimate fallback parsed:', emails);
    } catch (e) {
      console.error('[RECIPIENT_PARSER] Ultimate fallback failed:', e);
    }
  }

  return Array.from(new Set(emails));
}

function extractEmailsFromString(text: string): string[] {
  const matches = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/g);
  return matches ? matches.map((m) => m.toLowerCase().trim()) : [];
}

function resolveGmailThreadId(composeBox: Element): string | undefined {
  // 1. Try to find closest thread container in conversation view
  const closestThreadContainer = composeBox.closest('[data-thread-id]');
  if (closestThreadContainer) {
    const tid = closestThreadContainer.getAttribute('data-thread-id');
    if (tid && /^[a-f0-9]{16}$/.test(tid)) {
      return tid;
    }
  }

  // 2. Try looking for data-thread-id in the active view
  const mainContent = document.querySelector('[role="main"]');
  if (mainContent) {
    const activeThreadEl = mainContent.querySelector('[data-thread-id]');
    if (activeThreadEl) {
      const tid = activeThreadEl.getAttribute('data-thread-id');
      if (tid && /^[a-f0-9]{16}$/.test(tid)) {
        return tid;
      }
    }
  }

  // 3. Fallback to URL hash segments
  const hash = window.location.hash;
  if (hash) {
    const segments = hash.split('/');
    for (const segment of segments) {
      if (/^[a-f0-9]{16}$/.test(segment)) {
        return segment;
      }
    }
  }

  return undefined;
}

function showFailureModal(
  retryFn: () => void,
  sendWithoutTrackingFn: () => void,
  cancelFn: () => void
) {
  const existing = document.getElementById('dekha-kya-failure-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'dekha-kya-failure-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '2147483647';
  modal.style.fontFamily = 'Roboto, Arial, sans-serif';

  const box = document.createElement('div');
  box.style.backgroundColor = '#ffffff';
  box.style.padding = '24px';
  box.style.borderRadius = '8px';
  box.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.2)';
  box.style.width = '400px';
  box.style.textAlign = 'left';

  const title = document.createElement('h3');
  title.innerText = 'Tracking failed.';
  title.style.margin = '0 0 12px 0';
  title.style.fontSize = '18px';
  title.style.color = '#d93025';

  const desc = document.createElement('p');
  desc.innerText = 'Your draft has been preserved.';
  desc.style.margin = '0 0 24px 0';
  desc.style.fontSize = '14px';
  desc.style.color = '#3c4043';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';

  const btnCancel = document.createElement('button');
  btnCancel.innerText = 'Cancel';
  btnCancel.style.padding = '8px 16px';
  btnCancel.style.borderRadius = '4px';
  btnCancel.style.border = '1px solid #dadce0';
  btnCancel.style.backgroundColor = '#ffffff';
  btnCancel.style.color = '#3c4043';
  btnCancel.style.cursor = 'pointer';
  btnCancel.style.fontSize = '13px';
  btnCancel.addEventListener('click', () => {
    modal.remove();
    cancelFn();
  });

  const btnSendWithout = document.createElement('button');
  btnSendWithout.innerText = 'Send without tracking';
  btnSendWithout.style.padding = '8px 16px';
  btnSendWithout.style.borderRadius = '4px';
  btnSendWithout.style.border = '1px solid #dadce0';
  btnSendWithout.style.backgroundColor = '#ffffff';
  btnSendWithout.style.color = '#1a73e8';
  btnSendWithout.style.cursor = 'pointer';
  btnSendWithout.style.fontSize = '13px';
  btnSendWithout.addEventListener('click', () => {
    modal.remove();
    sendWithoutTrackingFn();
  });

  const btnRetry = document.createElement('button');
  btnRetry.innerText = 'Retry';
  btnRetry.style.padding = '8px 16px';
  btnRetry.style.borderRadius = '4px';
  btnRetry.style.border = 'none';
  btnRetry.style.backgroundColor = '#1a73e8';
  btnRetry.style.color = '#ffffff';
  btnRetry.style.cursor = 'pointer';
  btnRetry.style.fontSize = '13px';
  btnRetry.style.fontWeight = 'bold';
  btnRetry.addEventListener('click', () => {
    modal.remove();
    retryFn();
  });

  actions.appendChild(btnCancel);
  actions.appendChild(btnSendWithout);
  actions.appendChild(btnRetry);
  box.appendChild(title);
  box.appendChild(desc);
  box.appendChild(actions);
  modal.appendChild(box);
  document.body.appendChild(modal);
}


function injectToolbarIcon() {
  // Gmail's settings button or help icon inside the top-right toolbar
  const settingsBtn = document.querySelector('a[href*="settings"], [aria-label="Settings"], [data-tooltip="Settings"]');
  if (!settingsBtn) {
    // Retry in 1s if Gmail UI isn't fully rendered yet
    setTimeout(injectToolbarIcon, 1000);
    return;
  }

  const container = settingsBtn.parentElement;
  if (!container || container.querySelector('.dekh-kya-toolbar-btn-wrapper')) {
    return;
  }

  // Wrapper element
  const btnWrapper = document.createElement('div');
  btnWrapper.className = 'dekh-kya-toolbar-btn-wrapper';
  btnWrapper.style.position = 'relative';
  btnWrapper.style.display = 'inline-flex';
  btnWrapper.style.alignItems = 'center';
  btnWrapper.style.justifyContent = 'center';
  btnWrapper.style.marginRight = '8px';

  // Toolbar Button
  const btn = document.createElement('button');
  btn.className = 'dekh-kya-toolbar-btn';
  btn.style.background = 'none';
  btn.style.border = 'none';
  btn.style.padding = '4px';
  btn.style.cursor = 'pointer';
  btn.style.borderRadius = '50%';
  btn.style.width = '36px';
  btn.style.height = '36px';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.transition = 'background-color 0.15s';
  btn.title = 'Dekh Kya? Activity Tracker';

  btn.addEventListener('mouseover', () => {
    btn.style.backgroundColor = 'rgba(60, 64, 67, 0.1)';
  });
  btn.addEventListener('mouseout', () => {
    btn.style.backgroundColor = 'transparent';
  });

  // Logo Icon image (uses the new open envelope check logo!)
  const logoImg = document.createElement('img');
  logoImg.src = chrome.runtime.getURL('logo.png');
  logoImg.style.width = '20px';
  logoImg.style.height = '20px';
  logoImg.style.borderRadius = '50%';
  btn.appendChild(logoImg);

  // Red dot badge indicator
  const badge = document.createElement('span');
  badge.className = 'dekh-kya-badge';
  badge.style.position = 'absolute';
  badge.style.top = '4px';
  badge.style.right = '4px';
  badge.style.width = '8px';
  badge.style.height = '8px';
  badge.style.backgroundColor = '#ea4335'; // Gmail Red
  badge.style.borderRadius = '50%';
  badge.style.display = 'none'; // Hidden initially
  badge.style.border = '2px solid white';
  btnWrapper.appendChild(badge);

  btnWrapper.appendChild(btn);

  // Insert before settings button in the toolbar
  container.insertBefore(btnWrapper, settingsBtn);

  // Dropdown UI container
  const dropdown = document.createElement('div');
  dropdown.className = 'dekh-kya-dropdown';
  dropdown.style.position = 'absolute';
  dropdown.style.top = '40px';
  dropdown.style.right = '0';
  dropdown.style.width = '320px';
  dropdown.style.backgroundColor = '#18181b';
  dropdown.style.color = '#f4f4f5';
  dropdown.style.border = '1px solid #27272a';
  dropdown.style.borderRadius = '8px';
  dropdown.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -2px rgba(0,0,0,0.2)';
  dropdown.style.zIndex = '99999';
  dropdown.style.display = 'none'; // Hidden initially
  dropdown.style.padding = '16px';
  dropdown.style.fontFamily = 'Roboto, Arial, sans-serif';

  dropdown.innerHTML = `
    <style>
      .dekh-kya-activities::-webkit-scrollbar {
        width: 5px;
      }
      .dekh-kya-activities::-webkit-scrollbar-track {
        background: transparent;
      }
      .dekh-kya-activities::-webkit-scrollbar-thumb {
        background: #3f3f46;
        border-radius: 4px;
      }
      .dekh-kya-activities::-webkit-scrollbar-thumb:hover {
        background: #52525b;
      }
      .dekh-kya-activities {
        scrollbar-width: thin;
        scrollbar-color: #3f3f46 transparent;
      }
    </style>
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #27272a;padding-bottom:12px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <img src="${chrome.runtime.getURL('logo.png')}" style="width:20px;height:20px;border-radius:50%;" />
        <span style="font-weight:700;font-size:14px;color:#f4f4f5;">Dekh Kya? Activity</span>
      </div>
      <button class="dekh-kya-go-dashboard" style="background:#4f46e5;color:white;border:none;border-radius:4px;padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer;">Dashboard</button>
    </div>
    <div class="dekh-kya-activities" style="display:flex;flex-direction:column;gap:12px;max-height:280px;overflow-y:auto;min-height:50px;padding-right:4px;">
      <div style="text-align:center;color:#a1a1aa;font-size:12px;padding:12px 0;">Loading activity...</div>
    </div>
  `;

  btnWrapper.appendChild(dropdown);

  // Click to toggle dropdown view
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown.style.display === 'none';
    dropdown.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      badge.style.display = 'none'; // Clear red badge dot
      fetchToolbarActivities(dropdown.querySelector('.dekh-kya-activities')!);
    }
  });

  dropdown.querySelector('.dekh-kya-go-dashboard')?.addEventListener('click', () => {
    window.open(`${frontendUrl}/emails`, '_blank');
  });

  // Close dropdown on clicking outside
  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
  });
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Listen for message broadcasts from service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'NEW_ACTIVITY_LOGGED') {
      badge.style.display = 'block'; // Show red dot indicator
    }
  });
}

/**
 * Fetch top 5 recent opens from backend and display inside in-page dropdown.
 */
function fetchToolbarActivities(containerEl: HTMLElement) {
  chrome.runtime.sendMessage({ type: 'GET_LATEST_ACTIVITY' }, (res) => {
    containerEl.innerHTML = '';
    
    if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
      res.data.slice(0, 5).forEach((event: any) => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.gap = '10px';
        item.style.fontSize = '12px';
        item.style.borderBottom = '1px solid #27272a';
        item.style.padding = '8px 8px';
        item.style.lineHeight = '1.4';
        item.style.cursor = 'pointer';
        item.style.transition = 'background-color 0.15s';
        
        item.addEventListener('mouseover', () => {
          item.style.backgroundColor = '#27272a';
        });
        item.addEventListener('mouseout', () => {
          item.style.backgroundColor = 'transparent';
        });
        item.addEventListener('click', () => {
          window.open(`${frontendUrl}/emails?threadId=${event.threadId}`, '_blank');
        });
 
        // Fix field name mapping to prevent NaN
        const timeStr = getActivityRelativeTime(event.timestamp);
 
        item.innerHTML = `
          <div style="color:#10b981;flex-shrink:0;margin-top:2px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
               <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
               <circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <div>
            <div style="color:#f4f4f5;">Detected email activity from <strong>${event.recipientEmail}</strong></div>
            <div style="color:#a1a1aa;font-size:11px;margin-top:1px;">${event.subject}</div>
            <div style="color:#71717a;font-size:10px;margin-top:2px;">${timeStr}</div>
          </div>
        `;
        containerEl.appendChild(item);
      });
    } else {
      containerEl.innerHTML = '<div style="text-align:center;color:#a1a1aa;font-size:12px;padding:12px 0;font-style:italic;">No recent activity found.</div>';
    }
  });
}

/**
 * Format relative timestamps.
 */
function getActivityRelativeTime(dateStr: string): string {
  const now = new Date();
  const past = new Date(dateStr);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
