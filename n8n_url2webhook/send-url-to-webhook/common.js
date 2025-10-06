// Shared helpers for the extension (ES2020+, no external deps)

/** Defaults for settings stored in chrome.storage.sync */
export const DEFAULT_SETTINGS = {
  webhookUrl: "", // legacy single webhook (still supported for migration)
  webhookProfiles: [], // [{ id, name, url }]
  payloadMode: "plain", // 'plain' | 'json'
  jsonTemplate: '{"url":"{{url}}","title":"{{title}}","ts":"{{isoTimestamp}}","selection":"{{selection}}","source":"{{source}}"}',
  customHeaders: [],
  hmacSecret: null,
  useCanonical: false,
  includeSelection: false,
  includeOgData: false,
  stripParams: ["utm_*", "fbclid", "gclid"]
};

/** RFC4122 v4 UUID */
export function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" + hex.slice(4, 6).join("") +
    "-" + hex.slice(6, 8).join("") +
    "-" + hex.slice(8, 10).join("") +
    "-" + hex.slice(10, 16).join("")
  );
}

/**
 * Stable, simple hash used for de-duplication keys
 */
export function hashKey(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h2 >>> 15), 2246822507) ^ Math.imul(h2 ^ (h1 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h2 >>> 13), 3266489909);
  const n = 4294967296;
  const result = (h2 >>> 0) * n + (h1 >>> 0);
  return result.toString(16);
}

/** Load settings from chrome.storage.sync with defaults */
export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get({ settings: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

/** Merge + save settings to chrome.storage.sync */
export async function saveSettings(patch) {
  const current = await loadSettings();
  const updated = { ...current, ...patch };
  await chrome.storage.sync.set({ settings: updated });
  return updated;
}

/** Keep at most 50 history entries in chrome.storage.local */
export async function pushHistory(item) {
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  const next = [item, ...history].slice(0, 50);
  await chrome.storage.local.set({ history: next });
}

/**
 * Enqueue a job in chrome.storage.local
 * job: { id, attempt, createdAt, body, headers, webhookUrl, dedupeKey }
 */
export async function enqueue(job) {
  const { queue = [] } = await chrome.storage.local.get({ queue: [] });

  // Limit queue size to 50 items
  if (queue.length >= 50) {
    console.warn('Queue is full (50 items). Cannot add more failed requests.');
    return false;
  }

  queue.push(job);
  await chrome.storage.local.set({ queue });

  // Update badge
  if (typeof chrome !== 'undefined' && chrome.action) {
    await chrome.action.setBadgeText({ text: String(queue.length) });
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  }

  return true;
}

/** Exponential backoff in ms, capped at 32000ms (~2^5 * 1000) */
export function backoffDelay(attempt) {
  const base = Math.pow(2, attempt) * 1000;
  return Math.min(base, 32000);
}

/**
 * Basic URL canonicalization and tracking param removal
 */
export async function canonicalizeUrl(rawUrl, stripParams = [], canonicalFromPage = null) {
  try {
    const chosen = canonicalFromPage || rawUrl;
    const url = new URL(chosen);

    // Remove tracking parameters based on patterns
    const toDelete = [];
    const hasWildcard = (key) => key.endsWith("*");
    const wildcardPrefix = (key) => key.slice(0, -1);
    for (const [key] of url.searchParams.entries()) {
      let shouldDelete = false;
      for (const pattern of stripParams) {
        if (hasWildcard(pattern)) {
          if (key.startsWith(wildcardPrefix(pattern))) { shouldDelete = true; break; }
        } else if (key === pattern) {
          shouldDelete = true; break;
        }
      }
      if (shouldDelete) toDelete.push(key);
    }
    toDelete.forEach(k => url.searchParams.delete(k));
    // Sort params for stability
    const params = new URLSearchParams(url.searchParams);
    const sorted = new URLSearchParams();
    Array.from(params.entries()).sort(([a],[b]) => a.localeCompare(b)).forEach(([k,v]) => sorted.append(k,v));
    url.search = sorted.toString() ? `?${sorted.toString()}` : "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/** Get active tab (id, url, title) */
export async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) return null;
  return { id: tab.id, url: tab.url || "", title: tab.title || "" };
}

/** Execute script to get selection text from the page */
export async function getSelection(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection && window.getSelection().toString()) || ""
    });
    return result || "";
  } catch {
    return "";
  }
}

/** Extract OG data and published time via on-demand script */
export async function getOgData(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
        let publishedTime = text('meta[property="article:published_time"]');
        if (!publishedTime) {
          // Try JSON-LD Article
          const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
          for (const s of scripts) {
            try {
              const obj = JSON.parse(s.textContent || "{}");
              const graph = Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
              for (const node of graph) {
                const type = node['@type'];
                if (type && (type === 'Article' || (Array.isArray(type) && type.includes('Article')))) {
                  if (node.datePublished) { publishedTime = node.datePublished; break; }
                }
              }
            } catch {}
            if (publishedTime) break;
          }
        }
        return {
          ogTitle: text('meta[property="og:title"]'),
          ogType: text('meta[property="og:type"]'),
          publishedTime
        };
      }
    });
    return result || { ogTitle: "", ogType: "", publishedTime: "" };
  } catch {
    return { ogTitle: "", ogType: "", publishedTime: "" };
  }
}

/** Naive mustache-like replace with JSON escaping */
export async function renderTemplate(tpl, data) {
  return tpl.replace(/\{\{(.*?)\}\}/g, (_, k) => {
    const key = String(k).trim();
    const val = data[key];
    if (val == null) return "";
    // Escape for JSON: quotes, backslashes, and control characters
    return String(val)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  });
}

/** Compute HMAC-SHA256 over a message string and return lowercase hex */
export async function hmacSHA256Hex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  const bytes = new Uint8Array(signature);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Dequeue one item and attempt to send; returns result */
export async function dequeueAndSend() {
  const store = await chrome.storage.local.get({ queue: [] });
  const queue = store.queue || [];
  if (queue.length === 0) return { ok: true, empty: true };
  const job = queue[0];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(job.webhookUrl, {
      method: "POST",
      headers: job.headers,
      body: job.body,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { ok: false, status: res.status, retryable: res.status === 429 || (res.status >= 500 && res.status < 600), job };
    }
    // success: remove from queue
    queue.shift();
    await chrome.storage.local.set({ queue });
    return { ok: true, status: res.status };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, error: String(e), retryable: true, job };
  }
}


