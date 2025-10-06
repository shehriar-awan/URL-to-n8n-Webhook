import { loadSettings } from './common.js';

const statusEl = document.getElementById('status');
const retryBtn = document.getElementById('retry');
const profileSelect = document.getElementById('profileSelect');
const sendBtn = document.getElementById('sendBtn');
const queueInfo = document.getElementById('queueInfo');
const forceSendRow = document.getElementById('forceSendRow');
const forceSendBtn = document.getElementById('forceSendBtn');
const emptyState = document.getElementById('emptyState');
const mainContent = document.getElementById('mainContent');
const openOptionsBtn = document.getElementById('openOptionsBtn');
const openOptionsLink = document.getElementById('openOptionsLink');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');

async function loadProfiles() {
  const s = await loadSettings();
  const profiles = s.webhookProfiles && s.webhookProfiles.length ? s.webhookProfiles : (s.webhookUrl ? [{ id: 'legacy', name: 'Default', url: s.webhookUrl }] : []);

  if (profiles.length === 0) {
    emptyState.style.display = 'block';
    mainContent.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  mainContent.style.display = 'block';

  profileSelect.innerHTML = '';
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.url;
    opt.textContent = `${p.name}`;
    profileSelect.appendChild(opt);
  }
  sendBtn.disabled = false;
}

async function sendActiveSelected(forceSend = false) {
  statusEl.textContent = 'Sending…';
  statusEl.classList.remove('ok','err');
  sendBtn.disabled = true;
  forceSendRow.style.display = 'none';

  const selectedWebhook = profileSelect.value || '';
  const res = await chrome.runtime.sendMessage({ type: 'SEND_ACTIVE', webhookUrl: selectedWebhook, forceSend }).catch(() => ({ ok: false, message: 'Extension error: Failed to communicate with background service' }));

  sendBtn.disabled = false;

  if (res?.ok) {
    statusEl.textContent = '✓ Sent successfully';
    statusEl.classList.add('ok');
    setTimeout(() => {
      statusEl.textContent = 'Ready';
      statusEl.classList.remove('ok');
    }, 2000);
  } else {
    let errorMsg = res?.message || res?.error || 'Unknown error occurred';
    if (errorMsg === 'No webhook configured') {
      errorMsg = 'No webhook configured. Click ⚙ to open options and add one.';
    }
    statusEl.textContent = errorMsg;
    statusEl.classList.add('err');

    // Show force send button if duplicate detected
    if (res?.canRetry) {
      forceSendRow.style.display = 'flex';
    }
  }
}

async function updateQueueInfo() {
  const { queue = [] } = await chrome.storage.local.get({ queue: [] });
  if (queue.length === 0) {
    queueInfo.textContent = '';
    retryBtn.style.display = 'none';
    clearQueueBtn.style.display = 'none';
  } else {
    queueInfo.textContent = `${queue.length} item${queue.length > 1 ? 's' : ''} queued for retry`;
    retryBtn.style.display = 'block';
    clearQueueBtn.style.display = 'block';
  }
  // Update badge
  await chrome.action.setBadgeText({ text: queue.length > 0 ? String(queue.length) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}

async function updateHistory() {
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  if (history.length === 0) {
    historySection.style.display = 'none';
    return;
  }

  historySection.style.display = 'block';
  historyList.innerHTML = '';

  const recent = history.slice(0, 5);
  for (const item of recent) {
    const div = document.createElement('div');
    div.style.cssText = 'padding:4px 0;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center';

    const urlSpan = document.createElement('span');
    urlSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333';
    urlSpan.textContent = item.targetUrl || 'Unknown URL';
    urlSpan.title = item.targetUrl;

    const statusSpan = document.createElement('span');
    statusSpan.style.cssText = 'margin-left:8px;font-size:10px;';
    if (item.error) {
      statusSpan.textContent = '✗';
      statusSpan.style.color = '#d93025';
      statusSpan.title = item.error;
    } else if (item.httpStatus >= 200 && item.httpStatus < 300) {
      statusSpan.textContent = '✓';
      statusSpan.style.color = '#107c10';
      statusSpan.title = `HTTP ${item.httpStatus}`;
    } else {
      statusSpan.textContent = '?';
      statusSpan.style.color = '#666';
    }

    div.appendChild(urlSpan);
    div.appendChild(statusSpan);
    historyList.appendChild(div);
  }
}

retryBtn.addEventListener('click', async () => {
  retryBtn.disabled = true;
  retryBtn.textContent = 'Retrying…';
  await chrome.runtime.sendMessage({ type: 'RETRY_QUEUE' });
  setTimeout(async () => {
    await updateQueueInfo();
    retryBtn.disabled = false;
    retryBtn.textContent = '↻ Retry Queue';
  }, 1000);
});

clearQueueBtn.addEventListener('click', async () => {
  if (confirm('Clear all queued items? This cannot be undone.')) {
    await chrome.storage.local.set({ queue: [] });
    await updateQueueInfo();
    await updateHistory();
  }
});

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

openOptionsLink.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

sendBtn.addEventListener('click', () => sendActiveSelected(false));
forceSendBtn.addEventListener('click', () => sendActiveSelected(true));

loadProfiles();
updateQueueInfo();
updateHistory();
statusEl.textContent = 'Ready';

// Update queue info and history periodically
setInterval(() => {
  updateQueueInfo();
  updateHistory();
}, 2000);


