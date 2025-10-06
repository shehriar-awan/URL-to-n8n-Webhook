import {
  DEFAULT_SETTINGS,
  loadSettings,
  pushHistory,
  enqueue,
  dequeueAndSend,
  getActiveTab,
  getSelection,
  getOgData,
  renderTemplate,
  canonicalizeUrl,
  hmacSHA256Hex,
  uuid,
  hashKey,
  backoffDelay
} from './common.js';

const DEDUPE_TTL_MS = 60_000;

async function shouldDeduplicate(dedupeKey) {
  const now = Date.now();
  const { dedupe = {} } = await chrome.storage.local.get({ dedupe: {} });
  const last = dedupe[dedupeKey];
  if (last && now - last < DEDUPE_TTL_MS) return true;

  // Clean up expired entries
  const cleaned = {};
  for (const [key, timestamp] of Object.entries(dedupe)) {
    if (now - timestamp < DEDUPE_TTL_MS) {
      cleaned[key] = timestamp;
    }
  }
  cleaned[dedupeKey] = now;
  await chrome.storage.local.set({ dedupe: cleaned });
  return false;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function buildRequest({ baseUrl, tab, settings, selectionOpt, ogOpt }) {
  const nowIso = new Date().toISOString();
  const payloadMode = settings.payloadMode || 'plain';
  const template = settings.jsonTemplate || DEFAULT_SETTINGS.jsonTemplate;

  const data = {
    url: baseUrl,
    title: tab?.title || '',
    isoTimestamp: nowIso,
    selection: settings.includeSelection ? (selectionOpt || '') : '',
    ogTitle: settings.includeOgData ? (ogOpt?.ogTitle || '') : '',
    ogType: settings.includeOgData ? (ogOpt?.ogType || '') : '',
    publishedTime: settings.includeOgData ? (ogOpt?.publishedTime || '') : '',
    source: 'chrome-ext'
  };

  let body;
  let contentType;
  if (payloadMode === 'json') {
    const rendered = await renderTemplate(template, data);
    body = rendered;
    contentType = 'application/json';
  } else {
    body = baseUrl;
    contentType = 'text/plain';
  }

  const headers = {};
  headers['Content-Type'] = contentType;
  for (const h of settings.customHeaders || []) {
    if (h?.name) headers[h.name] = String(h.value ?? '');
  }
  headers['X-Timestamp'] = nowIso;
  headers['X-Request-ID'] = uuid();
  if (settings.hmacSecret) {
    headers['X-Signature'] = await hmacSHA256Hex(settings.hmacSecret, body);
  }

  return { body, headers };
}

async function sendOrEnqueue({ action, targetUrl, tabId, overrideWebhookUrl, forceSend = false }) {
  const settings = await loadSettings();
  const configuredUrl = (typeof overrideWebhookUrl === 'string' ? overrideWebhookUrl : overrideWebhookUrl?.url) || (settings.webhookProfiles && settings.webhookProfiles[0]?.url) || settings.webhookUrl;
  if (!configuredUrl) {
    await pushHistory({
      id: uuid(), when: new Date().toISOString(), action,
      targetUrl, httpStatus: null, error: 'No webhook configured',
      requestSummary: { method: 'POST', headers: {}, size: 0 }
    });
    return { ok: false, message: 'No webhook configured' };
  }

  if (!targetUrl || targetUrl.startsWith('chrome://') || targetUrl.startsWith('chrome-extension://')) {
    await pushHistory({ id: uuid(), when: new Date().toISOString(), action, targetUrl, httpStatus: null, error: 'Cannot send chrome:// or extension URLs', requestSummary: { method: 'POST', headers: {}, size: 0 } });
    return { ok: false, message: 'Cannot send chrome:// or extension URLs' };
  }

  let canonicalFromPage = null;
  if (settings.useCanonical && tabId) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const link = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
            || document.querySelector('meta[property="og:url"]')?.getAttribute('content');
          return link || null;
        }
      });
      canonicalFromPage = result || null;
    } catch {}
  }

  const cleanedUrl = await canonicalizeUrl(targetUrl, settings.stripParams || [], canonicalFromPage);

  const selection = settings.includeSelection && tabId ? await getSelection(tabId) : '';
  const ogData = settings.includeOgData && tabId ? await getOgData(tabId) : null;

  const tabForMeta = tabId ? await chrome.tabs.get(tabId).catch(() => ({})) : {};
  const { body, headers } = await buildRequest({ baseUrl: cleanedUrl, tab: tabForMeta, settings, selectionOpt: selection, ogOpt: ogData });

  const dedupeKey = hashKey(`POST|${configuredUrl}|${body}`);
  if (!forceSend && await shouldDeduplicate(dedupeKey)) {
    await pushHistory({ id: uuid(), when: new Date().toISOString(), action, targetUrl: cleanedUrl, httpStatus: null, error: 'Already sent recently (duplicate blocked)', requestSummary: { method: 'POST', headers, size: body.length } });
    return { ok: false, message: 'URL already sent in last 60s', canRetry: true };
  }

  // Try to copy to clipboard non-blocking
  copyToClipboard(cleanedUrl);

  // Send with timeout; on failure enqueue
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let httpStatus = null;
  let error = null;
  try {
    const res = await fetch(configuredUrl, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timeout);
    httpStatus = res.status;
    if (!res.ok) {
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (res.status === 404) {
        error = `Webhook not found (HTTP 404). Check your webhook URL.`;
      } else if (res.status === 401 || res.status === 403) {
        error = `Webhook authentication failed (HTTP ${res.status}). Check your credentials.`;
      } else if (res.status === 429) {
        error = `Rate limited (HTTP 429). Will retry automatically.`;
      } else if (res.status >= 500) {
        error = `Webhook server error (HTTP ${res.status}). Will retry automatically.`;
      } else {
        error = `Webhook returned HTTP ${res.status}`;
      }
      if (retryable) {
        const queued = await enqueue({ id: uuid(), attempt: 0, createdAt: new Date().toISOString(), body, headers, webhookUrl: configuredUrl, dedupeKey, targetUrl: cleanedUrl, action });
        if (queued) {
          setTimeout(processQueue, 0);
        } else {
          error = 'Queue is full (50 items max). Please clear queue or wait for retries to complete.';
        }
      }
    }
  } catch (e) {
    clearTimeout(timeout);
    const errMsg = String(e);
    if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
      error = 'Network error. Check your internet connection. Will retry.';
    } else if (errMsg.includes('aborted')) {
      error = 'Request timed out after 10 seconds. Will retry.';
    } else {
      error = `Connection failed: ${errMsg.slice(0, 100)}`;
    }
    const queued = await enqueue({ id: uuid(), attempt: 0, createdAt: new Date().toISOString(), body, headers, webhookUrl: configuredUrl, dedupeKey, targetUrl: cleanedUrl, action });
    if (queued) {
      setTimeout(processQueue, 0);
    } else {
      error = 'Queue is full (50 items max). Please clear queue or wait for retries to complete.';
    }
  }

  await pushHistory({ id: uuid(), when: new Date().toISOString(), action, targetUrl: cleanedUrl, httpStatus, error, requestSummary: { method: 'POST', headers, size: body.length } });

  // Show notification on success
  if (!error && httpStatus >= 200 && httpStatus < 300) {
    const settings = await loadSettings();
    if (settings.showNotifications !== false) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'URL Sent to n8n',
        message: `Successfully sent to ${new URL(configuredUrl).hostname}`,
        silent: true
      });
    }
  }

  return { ok: !error && httpStatus && httpStatus >= 200 && httpStatus < 300, status: httpStatus, error };
}

let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  try {
    const store = await chrome.storage.local.get({ queue: [] });
    const queue = store.queue || [];
    if (queue.length === 0) return;
    const job = queue[0];
    const result = await dequeueAndSend();
    if (!result.ok) {
      // schedule retry with backoff up to 5 attempts
      job.attempt = (job.attempt || 0) + 1;
      if (job.attempt > 5 || !result.retryable) {
        // drop and record failure
        queue.shift();
        await chrome.storage.local.set({ queue });
        await pushHistory({ id: uuid(), when: new Date().toISOString(), action: job.action || 'retry', targetUrl: job.targetUrl || '', httpStatus: result.status ?? null, error: result.error || `Failed permanently after ${job.attempt} retry attempts`, requestSummary: { method: 'POST', headers: job.headers, size: job.body?.length || 0 } });
        setTimeout(() => { isProcessingQueue = false; processQueue(); }, 0);
        return;
      }
      queue[0] = job;
      await chrome.storage.local.set({ queue });
      const delay = backoffDelay(job.attempt);
      setTimeout(() => { isProcessingQueue = false; processQueue(); }, delay);
    } else {
      // success; process next if any
      setTimeout(() => { isProcessingQueue = false; processQueue(); }, 0);
    }
  } finally {
    if (isProcessingQueue) {
      setTimeout(() => { isProcessingQueue = false; }, 0);
    }
  }
}

// Context menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'send_page', title: 'Send this page URL to n8n', contexts: ['page', 'frame'] });
    chrome.contextMenus.create({ id: 'send_link', title: 'Send link to n8n', contexts: ['link'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id;
  try {
    if (info.menuItemId === 'send_page') {
      const target = info.pageUrl || tab?.url || '';
      const result = await sendOrEnqueue({ action: 'context:page', targetUrl: target, tabId });
      if (!result.ok && result.error) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Failed to Send URL',
          message: result.error || 'Unknown error',
          priority: 1
        });
      }
    } else if (info.menuItemId === 'send_link') {
      const target = info.linkUrl || '';
      const result = await sendOrEnqueue({ action: 'context:link', targetUrl: target, tabId });
      if (!result.ok && result.error) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Failed to Send URL',
          message: result.error || 'Unknown error',
          priority: 1
        });
      }
    }
  } catch (err) {
    console.error('Context menu error:', err);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Error',
      message: 'Failed to send URL. Check extension settings.',
      priority: 1
    });
  }
});

// Keyboard command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'send-url-command') {
    const tab = await getActiveTab();
    if (tab) {
      await sendOrEnqueue({ action: 'shortcut', targetUrl: tab.url, tabId: tab.id });
    }
  }
});

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'SEND_ACTIVE') {
      const tab = await getActiveTab();
      if (!tab) return sendResponse({ ok: false, message: 'No tab is currently active' });
      const res = await sendOrEnqueue({ action: 'click', targetUrl: tab.url, tabId: tab.id, overrideWebhookUrl: message?.webhookUrl, forceSend: message?.forceSend });
      return sendResponse(res);
    }
    if (message?.type === 'SEND_LINK' && message?.url) {
      const tab = await getActiveTab();
      const res = await sendOrEnqueue({ action: 'context:link', targetUrl: message.url, tabId: tab?.id });
      return sendResponse(res);
    }
    if (message?.type === 'RETRY_QUEUE') {
      processQueue();
      return sendResponse({ ok: true });
    }
  })();
  return true; // async
});

// Attempt queue processing when network comes back or SW wakes
setTimeout(processQueue, 1000);


