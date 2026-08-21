interface RecentEvent {
  subject: string;
  recipientEmail: string;
  openedAt: string;
}

document.addEventListener('DOMContentLoaded', () => {
  const activityList = document.getElementById('activity-list')!;
  const trackingToggle = document.getElementById('tracking-toggle') as HTMLInputElement;
  const statusLabel = document.getElementById('status-label')!;
  const btnDashboard = document.getElementById('btn-dashboard')!;

  // 1. Redirect to Dashboard website
  btnDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://dekha-kya.vercel.app/emails' });
  });

  // 2. Manage Tracking Toggle Switch state
  chrome.storage.local.get(['trackingEnabled'], (result) => {
    // Defaults to true if not defined yet
    const enabled = result.trackingEnabled !== false;
    trackingToggle.checked = enabled;
    statusLabel.innerText = enabled ? 'Tracking enabled' : 'Tracking disabled';
  });

  trackingToggle.addEventListener('change', () => {
    const enabled = trackingToggle.checked;
    chrome.storage.local.set({ trackingEnabled: enabled }, () => {
      statusLabel.innerText = enabled ? 'Tracking enabled' : 'Tracking disabled';
    });
  });

  // 3. Query authenticated status & latest activity
  chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (authRes) => {
    if (authRes && authRes.success && authRes.data && authRes.data.authenticated) {
      // Authenticated! Fetch latest opens
      chrome.runtime.sendMessage({ type: 'GET_LATEST_ACTIVITY' }, (activityRes) => {
        activityList.innerHTML = ''; // Clear loading spinner

        if (activityRes && activityRes.success && Array.isArray(activityRes.data) && activityRes.data.length > 0) {
          // Render top 5 events
          const events: RecentEvent[] = activityRes.data.slice(0, 5);
          
          events.forEach((event) => {
            const item = document.createElement('div');
            item.className = 'activity-item';

            const timeStr = formatRelativeTime(event.openedAt);

            item.innerHTML = `
              <div class="activity-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </div>
              <div class="activity-details">
                <div class="activity-text"><strong>${event.recipientEmail}</strong> opened your email</div>
                <div class="activity-subject">${event.subject}</div>
                <div class="activity-time">${timeStr}</div>
              </div>
            `;
            activityList.appendChild(item);
          });
        } else {
          activityList.innerHTML = '<div class="no-activity">No recent activity found.</div>';
        }
      });
    } else {
      // Not authenticated
      activityList.innerHTML = `
        <div class="no-activity" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 0;">
          <span>Please link your Gmail account first to start tracking.</span>
          <button id="btn-login" style="background:#4f46e5;color:#ffffff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:600;font-size:11px;">Connect Gmail</button>
        </div>
      `;
      
      document.getElementById('btn-login')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_OAUTH_TAB' });
      });
    }
  });
});

/**
 * Basic formatter for relative time descriptions.
 */
function formatRelativeTime(dateStr: string): string {
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
