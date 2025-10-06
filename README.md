# URL to n8n Webhook

A Chrome extension that sends the current page URL to n8n webhooks, enabling you to trigger workflows instantly from any webpage.

![Version](https://img.shields.io/badge/version-1.1.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)

## Features

### 🚀 Core Functionality
- **One-click URL sending** - Click the extension popup to send current tab URL to n8n
- **Multiple webhook profiles** - Configure and switch between different n8n webhooks
- **Keyboard shortcut** - `Ctrl+Shift+U` (Windows/Linux) or `Cmd+Shift+U` (Mac) for instant sending
- **Context menu integration** - Right-click to send page URL or link URL
- **Automatic clipboard copy** - URL is copied to clipboard when sent

### 🛡️ Reliability Features
- **Automatic retry with exponential backoff** - Failed requests retry up to 5 times
- **Queue management** - View queued items, manual retry, and clear queue options
- **Deduplication** - Prevents sending same URL multiple times within 60 seconds
- **Request history** - View last 5 sent URLs with status indicators
- **Desktop notifications** - Optional success/error notifications
- **Badge counter** - Shows number of queued retry items on extension icon

### ⚙️ Advanced Options
- **Plain text or JSON payloads** - Send just the URL or rich JSON with metadata
- **Customizable JSON templates** - Define your own payload structure with placeholders
- **URL processing** - Canonical URL detection and tracking parameter removal
- **Metadata inclusion** - Optional page title, selection text, Open Graph data
- **Custom HTTP headers** - Add your own headers to requests
- **HMAC signatures** - Sign requests with HMAC-SHA256 for security
- **Settings export/import** - Backup and restore your configuration

## Installation

### From Chrome Web Store (Recommended)
*Coming soon*

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the extension folder
6. The extension icon should appear in your toolbar

## Quick Start

### 1. Configure Your First Webhook

1. Click the extension icon
2. Click **Open Settings** (or right-click extension icon → Options)
3. Click **Add webhook**
4. Enter:
   - **Name**: e.g., "My n8n Workflow"
   - **URL**: Your n8n webhook URL (e.g., `https://your-n8n.com/webhook/abc123`)
5. Click **Test** to verify the webhook works
6. Click **Save**

### 2. Send Your First URL

**Method 1: Extension Popup**
1. Navigate to any webpage
2. Click the extension icon
3. Select your webhook (if you have multiple)
4. Click **Send**

**Method 2: Keyboard Shortcut**
1. Navigate to any webpage
2. Press `Ctrl+Shift+U` (or `Cmd+Shift+U` on Mac)

**Method 3: Context Menu**
1. Right-click on any page
2. Select **Send this page URL to n8n**

## Configuration Guide

### Payload Settings

#### Plain Text Mode (Default)
Sends only the URL as `text/plain`:
```
https://example.com/article
```

#### JSON Mode
Sends structured data as `application/json`:
```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "ts": "2025-01-15T10:30:00.000Z",
  "selection": "",
  "source": "chrome-ext"
}
```

**Available Template Placeholders:**
- `{{url}}` - The page URL (cleaned and processed)
- `{{title}}` - Page title
- `{{isoTimestamp}}` - Current timestamp in ISO format
- `{{selection}}` - Selected text (if enabled)
- `{{ogTitle}}` - Open Graph title (if enabled)
- `{{ogType}}` - Open Graph type (if enabled)
- `{{publishedTime}}` - Article published time (if available)
- `{{source}}` - Always "chrome-ext"

### URL Processing

**Use canonical URL from page metadata**
- Detects and uses `<link rel="canonical">` or `og:url` meta tags
- Useful for sites with dynamic URLs

**Strip query parameters**
- Removes tracking parameters like `utm_*`, `fbclid`, `gclid`
- Supports wildcards: `utm_*` removes all parameters starting with "utm_"
- Example: `utm_*,fbclid,gclid,ref`

### Additional Data

**Include selected text from page**
- Captures any text selected on the page
- Added to `{{selection}}` placeholder in JSON mode

**Include Open Graph metadata**
- Extracts `og:title`, `og:type`, and `article:published_time`
- Useful for article/blog tracking

### Custom Headers

Add custom HTTP headers to all webhook requests:
- Header name: `X-Custom-Header`
- Header value: `custom-value`

Automatically included headers:
- `Content-Type`: `text/plain` or `application/json`
- `X-Timestamp`: ISO timestamp of request
- `X-Request-ID`: Unique UUID for each request
- `X-Signature`: HMAC-SHA256 signature (if HMAC secret configured)

### HMAC Signature

Secure your webhooks with HMAC-SHA256 signatures:

1. Enter a secret key (minimum 16 characters recommended)
2. Save settings
3. Every request will include an `X-Signature` header

**Verify in n8n:**
```javascript
// In your n8n webhook workflow
const receivedSignature = $headers['x-signature'];
const secret = 'your-secret-key';
const body = $body;
const crypto = require('crypto');
const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(JSON.stringify(body))
  .digest('hex');

if (receivedSignature !== expectedSignature) {
  throw new Error('Invalid signature');
}
```

## Features in Detail

### Queue Management

When webhook requests fail (network issues, timeouts, server errors), they are automatically queued for retry.

**Viewing Queue:**
- Popup shows: "X items queued for retry"
- Extension badge shows queue count
- Queue limited to 50 items maximum

**Retry Behavior:**
- Exponential backoff: 2s, 4s, 8s, 16s, 32s
- Maximum 5 retry attempts
- Automatic retry for: 429 (rate limit), 5xx (server errors), network errors, timeouts

**Manual Actions:**
- **Retry Queue**: Manually trigger retry of all queued items
- **Clear Queue**: Remove all queued items (requires confirmation)

### Deduplication

Prevents accidental duplicate sends within 60 seconds.

**How it works:**
1. Send `https://example.com` at 10:00:00
2. Try to send same URL again at 10:00:30 → **Blocked** with error: "URL already sent in last 60s"
3. **Force Send Anyway** button appears if you intentionally want to resend
4. After 10:01:00 → Can send again normally

### History

View your recent webhook activity in the popup:
- ✓ Green checkmark = Success (HTTP 200-299)
- ✗ Red X = Failed (hover for error message)
- Last 5 URLs shown
- Full URL visible on hover

### Settings Export/Import

**Export Settings:**
1. Go to Options page
2. Click **Export Settings**
3. Saves JSON file: `url-to-n8n-settings-YYYY-MM-DD.json`

**Import Settings:**
1. Go to Options page
2. Click **Import Settings**
3. Select your JSON file
4. Page reloads with imported settings

**Use cases:**
- Backup your configuration
- Share settings between computers
- Migrate to new browser profile

### Testing Webhooks

**Test Single Webhook:**
- Click **Test** button next to any webhook
- Sends test payload: `test://webhook`
- Shows result inline with color coding

**Test All Webhooks:**
- Click **Test All Webhooks** button
- Tests all configured webhooks in sequence
- Shows summary: "✓ Success: X, ✗ Failed: Y"

## Troubleshooting

### Common Errors and Solutions

#### ❌ "No webhook configured. Click ⚙ to open options and add one."

**Problem:** No webhook has been set up yet.

**Solution:**
1. Click the extension icon
2. Click **Open Settings** button
3. Add a webhook URL and save

---

#### ❌ "URL already sent in last 60s"

**Problem:** Duplicate prevention blocked the request.

**Why:** You tried to send the same URL to the same webhook within 60 seconds.

**Solutions:**
- Wait 60 seconds and try again
- Click **⚠ Force Send Anyway** button to bypass deduplication
- This is intentional to prevent accidental double-clicking

---

#### ❌ "Cannot send chrome:// or extension URLs"

**Problem:** Trying to send a Chrome internal page or extension page.

**Why:** Chrome internal URLs cannot be sent to external webhooks for security reasons.

**Solution:** This is expected behavior. Only regular web pages (http/https) can be sent.

---

#### ❌ "Webhook not found (HTTP 404). Check your webhook URL."

**Problem:** The webhook URL is incorrect or doesn't exist.

**Solutions:**
1. Check your n8n webhook URL is correct
2. Verify the workflow is active in n8n
3. Test the webhook in n8n first
4. Copy the webhook URL again from n8n

---

#### ❌ "Webhook authentication failed (HTTP 401/403). Check your credentials."

**Problem:** The webhook requires authentication that isn't configured.

**Solutions:**
1. If your n8n webhook requires authentication, add auth headers in **Custom Headers**
2. Check if your n8n instance requires API keys
3. Verify firewall/network isn't blocking the request

---

#### ❌ "Rate limited (HTTP 429). Will retry automatically."

**Problem:** Too many requests sent too quickly.

**Why:** n8n or your server has rate limiting enabled.

**Solutions:**
- Wait a few minutes - the extension will retry automatically
- Reduce frequency of sending URLs
- Check n8n rate limit settings
- Request will retry with exponential backoff

---

#### ❌ "Webhook server error (HTTP 500). Will retry automatically."

**Problem:** n8n server or workflow encountered an error.

**Solutions:**
1. Check n8n workflow execution logs
2. Verify workflow logic doesn't have errors
3. Check n8n server status/logs
4. Extension will retry automatically
5. If persists, check n8n community forums

---

#### ❌ "Network error. Check your internet connection. Will retry."

**Problem:** Cannot reach the webhook server.

**Solutions:**
1. Check your internet connection
2. Verify the webhook URL is accessible (test in browser)
3. Check if VPN/proxy is blocking the request
4. Verify firewall settings
5. Extension will retry automatically when connection restored

---

#### ❌ "Request timed out after 10 seconds. Will retry."

**Problem:** Webhook took too long to respond.

**Solutions:**
1. Check n8n server performance/load
2. Optimize workflow in n8n (reduce processing time)
3. Check network latency
4. Extension will retry automatically
5. If workflow needs >10s, consider async processing in n8n

---

#### ❌ "Queue is full (50 items max). Please clear queue or wait for retries to complete."

**Problem:** Too many failed requests queued.

**Why:** Maximum queue size (50 items) reached to prevent memory issues.

**Solutions:**
1. Click **Clear Queue** to remove all queued items
2. Click **↻ Retry Queue** to process queued items
3. Wait for automatic retries to complete
4. Fix underlying webhook/network issues causing failures

---

#### ❌ "Failed permanently after 5 retry attempts"

**Problem:** Request failed and exhausted all retries.

**Why:** Webhook remained unreachable/broken after 5 attempts with exponential backoff.

**Solutions:**
1. Check webhook URL is correct
2. Verify n8n workflow is active and working
3. Test webhook manually in n8n
4. Check n8n server logs for errors
5. Review request in history for specific error details

---

#### ❌ "Duplicate webhook name: [name]"

**Problem:** Trying to save two webhooks with the same name.

**Solution:** Give each webhook a unique name.

---

#### ❌ "Duplicate webhook URL found. Each webhook must have a unique URL."

**Problem:** Trying to save two webhooks with the same URL.

**Solution:** Each webhook profile must have a different URL.

---

#### ❌ "Invalid URL: [name]"

**Problem:** Webhook URL is not a valid HTTP/HTTPS URL.

**Solutions:**
1. URL must start with `http://` or `https://`
2. Check for typos in the URL
3. Copy URL directly from n8n webhook node

---

#### ❌ "HMAC secret should be at least 16 characters for security"

**Problem:** HMAC secret is too short.

**Solution:** Use a stronger secret key with at least 16 characters for security.

**Generate strong secret:**
```bash
# On Linux/Mac
openssl rand -hex 32

# Or use password generator
```

---

#### ❌ "Extension error: Failed to communicate with background service"

**Problem:** Extension internal communication failed.

**Solutions:**
1. Reload the extension:
   - Go to `chrome://extensions/`
   - Click reload icon on this extension
2. Restart Chrome
3. If persists, reinstall extension

---

#### ❌ "No tab is currently active"

**Problem:** No browser tab is open/active.

**Solution:** Open a webpage and try again.

---

### Testing Issues

#### Test button shows "✗ Timeout - Request took longer than 10 seconds"

**Solutions:**
1. Check n8n server is running and accessible
2. Verify webhook URL is correct
3. Test URL in browser to ensure it's reachable
4. Check for network/firewall issues

---

#### Test shows success but workflow doesn't trigger

**Solutions:**
1. Check n8n workflow is activated (not paused)
2. Check workflow execution history in n8n
3. Verify webhook path matches exactly
4. Check n8n webhook node settings

---

### Context Menu Not Working

**Problem:** Right-click menu doesn't show "Send to n8n" option.

**Solutions:**
1. Reload the page you're on
2. Check extension is enabled in `chrome://extensions/`
3. Some pages (like chrome:// pages) don't support extensions
4. Reload the extension

---

### Keyboard Shortcut Not Working

**Problem:** `Ctrl+Shift+U` doesn't send URL.

**Solutions:**
1. Check for keyboard shortcut conflicts:
   - Go to `chrome://extensions/shortcuts`
   - Find "URL to n8n Webhook"
   - Verify shortcut is assigned
   - Change if conflicting with another extension
2. Some pages may block shortcuts
3. Try clicking the extension icon instead

---

### Notifications Not Showing

**Problem:** No desktop notifications appear.

**Solutions:**
1. Check notifications are enabled in extension options
2. Check Chrome notification permissions:
   - Settings → Privacy and security → Site Settings → Notifications
   - Ensure Chrome can show notifications
3. Check OS notification settings
4. Try disabling/re-enabling in extension options

---

### Badge Not Updating

**Problem:** Extension icon badge doesn't show queue count.

**Solutions:**
1. Reload the extension
2. Restart Chrome
3. Check popup - queue info should still work

---

## Permissions Explained

This extension requests the following permissions:

| Permission | Why We Need It |
|------------|----------------|
| `tabs` | Read current tab URL and title |
| `storage` | Save your webhook settings and history |
| `clipboardWrite` | Copy URL to clipboard when sending |
| `contextMenus` | Add "Send to n8n" to right-click menu |
| `scripting` | Extract page metadata (canonical URL, Open Graph data) |
| `notifications` | Show success/error desktop notifications |
| `optional_host_permissions` | Send requests to your webhook URLs (only when you grant permission) |

**Privacy:** This extension does NOT:
- Collect any personal data
- Send data to any servers except your configured webhooks
- Track your browsing history
- Use analytics or telemetry

## FAQ

### Can I use this with services other than n8n?

Yes! Any service that accepts webhook POST requests will work. The extension just sends HTTP POST requests to the URL you configure.

### Does this work with self-hosted n8n?

Yes! Just use your self-hosted n8n webhook URL.

### Can I send to multiple webhooks at once?

Not simultaneously, but you can:
1. Configure multiple webhook profiles
2. Switch between them in the popup dropdown
3. Send to different workflows for different use cases

### What happens if my internet connection drops?

Failed requests are automatically queued and will retry when connection is restored.

### Can I customize the keyboard shortcut?

Yes! Go to `chrome://extensions/shortcuts` and customize the shortcut for this extension.

### How do I see what was sent?

Check the **Recent Activity** section in the popup for your last 5 sends with status indicators.

### Does this work on Firefox/Edge/Safari?

Currently Chrome only (Manifest V3). Edge may work since it's Chromium-based, but untested.

### Can I contribute or report bugs?

Yes! Please open an issue on GitHub: [GitHub Issues](https://github.com/your-repo/issues)

## Technical Details

- **Manifest Version:** 3
- **Storage:** Chrome Sync Storage (settings) + Local Storage (queue, history)
- **Service Worker:** Background processing for queue and retries
- **Queue Limit:** 50 items
- **History Limit:** 50 items
- **Retry Attempts:** 5 max
- **Request Timeout:** 10 seconds
- **Deduplication TTL:** 60 seconds
- **Backoff Strategy:** Exponential (2^attempt * 1000ms, max 32s)

## Support

- **Documentation:** This README
- **Issues:** [GitHub Issues](https://github.com/your-repo/issues)
- **n8n Community:** [n8n Forum](https://community.n8n.io/)

## License

MIT License - See LICENSE file for details

## Changelog

### Version 1.1.0 (Current)
- ✨ Added multiple webhook profiles support
- ✨ Added settings export/import
- ✨ Added history display in popup
- ✨ Added desktop notifications
- ✨ Added badge counter for queue
- ✨ Added "Test All Webhooks" feature
- ✨ Added clear queue button
- ✨ Added force send option for duplicates
- ✨ Added comprehensive validation
- 🐛 Fixed deduplication hash bug
- 🐛 Fixed XSS vulnerability in options page
- 🐛 Fixed race condition in queue processing
- 🐛 Fixed profile ID regeneration issue
- 🔒 Made host permissions optional
- 🔒 Added HMAC secret validation
- 💅 Improved all error messages
- 💅 Better empty state UI
- 💅 Improved options page layout

### Version 1.0.0
- Initial release

---

**Made with ❤️ for the n8n community**

