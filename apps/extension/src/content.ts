interface RegisterMessageRecipient {
  email: string;
  recipientType: 'TO' | 'CC' | 'BCC';
  displayName?: string;
}

console.log('Dekha Kya? Gmail tracker content script initialized.');

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
  checkbox.checked = true; // Checked by default if authenticated
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

    if (connectedEmail && activeGmailEmail && activeGmailEmail.toLowerCase() === connectedEmail.toLowerCase()) {
      statusSpan.innerHTML = `(<span style="color:#16a34a;font-weight:600;">✓</span> Connected: ${connectedEmail})`;
      checkbox.disabled = false;
      checkbox.checked = true;
      container.style.display = 'inline-flex';
    } else {
      // Hide the tracking option completely if they don't match or not authenticated
      checkbox.checked = false;
      checkbox.disabled = true;
      container.style.display = 'none';
    }
  });

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
          await handleTrackedSend(composeBox, res.data.email);
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
            await handleTrackedSend(composeBox, res.data.email);
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
async function handleTrackedSend(composeBox: Element, senderEmail: string) {
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
  let gmailThreadId: string | undefined = undefined;
  const match = window.location.hash.match(/#inbox\/([a-f0-9]+)/);
  if (match && match[1]) {
    gmailThreadId = match[1];
  }

  const cleanFromEmail = senderEmail;

  const sendPayload = {
    gmailThreadId,
    subject,
    htmlBody,
    plainTextBody,
    recipients,
    fromEmail: cleanFromEmail,
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
    (response: { success: boolean; error?: string } | undefined) => {
      if (response && response.success) {
        console.log('Tracked email successfully dispatched!');
        
        // Suppress the native "Draft discarded" toast that is triggered by programmatic click
        suppressGmailDiscardToast();

        // Show "Message sent." toast with link to Sent folder
        showGmailToast('Message sent.', 'View message', '#sent');

        // Restore display property temporarily so Gmail's discard/close events can fire correctly
        composeBoxElement.style.display = originalDisplay;

        // Close the Gmail compose window programmatically to sync draft
        const closeBtn = composeBox.querySelector('.Ha') || composeBox.querySelector('.og.T-I-atl.L3') || composeBox.querySelector('.og.T-I-J3');
        if (closeBtn instanceof HTMLElement) {
          closeBtn.click();
        } else {
          // Fallback UI removal
          composeBox.remove();
        }
      } else {
        console.error('Failed sending tracked email:', response?.error);
        
        // Remove the "Sending..." toast
        const existing = document.querySelector('.custom-gmail-toast');
        if (existing) existing.remove();

        // Restore visibility so the user doesn't lose their draft email
        composeBoxElement.style.display = originalDisplay;

        alert(`Tracking server error: ${response?.error || 'Tracking is temporarily unavailable. Your email can still be sent without tracking.'}`);
      }
    }
  );
}

/**
 * Shows a Gmail-style toast notification in the bottom-left corner.
 */
function showGmailToast(message: string, actionText?: string, actionLink?: string) {
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
  toast.style.gap = '24px';
  toast.style.fontFamily = 'Roboto, Arial, sans-serif';
  toast.style.fontSize = '14px';
  toast.style.zIndex = '2147483647';
  toast.style.transition = 'opacity 0.15s ease-in-out';
  toast.style.opacity = '1';

  const textSpan = document.createElement('span');
  textSpan.innerText = message;
  toast.appendChild(textSpan);

  if (actionText && actionLink) {
    const actionBtn = document.createElement('a');
    actionBtn.innerText = actionText;
    actionBtn.href = actionLink;
    actionBtn.style.color = '#8ab4f8';
    actionBtn.style.textDecoration = 'none';
    actionBtn.style.fontWeight = 'bold';
    actionBtn.style.cursor = 'pointer';
    actionBtn.style.fontSize = '14px';
    actionBtn.addEventListener('click', () => {
      toast.remove();
    });
    toast.appendChild(actionBtn);
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

// Start observing the page for compose window elements
initComposeObserver();
