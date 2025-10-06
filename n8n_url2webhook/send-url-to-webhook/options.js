import { DEFAULT_SETTINGS, loadSettings, saveSettings, uuid } from './common.js';

const $ = (id) => document.getElementById(id);
const profilesEl = $('profiles');
const addProfileBtn = $('addProfile');
const payloadMode = $('payloadMode');
const jsonTemplate = $('jsonTemplate');
const stripParams = $('stripParams');
const useCanonical = $('useCanonical');
const includeSelection = $('includeSelection');
const includeOgData = $('includeOgData');
const showNotifications = $('showNotifications');
const headersBody = $('headersBody');
const addHeader = $('addHeader');
const hmacSecret = $('hmacSecret');
const saveBtn = $('save');
const toast = $('toast');
const versionEl = $('version');
const testAllBtn = $('testAllBtn');
const exportBtn = $('exportBtn');
const importBtn = $('importBtn');
const importFile = $('importFile');

function setToast(msg, isError = false) {
  toast.textContent = msg;
  toast.className = isError ? 'toast error' : 'toast success';
  setTimeout(() => {
    toast.textContent = '';
    toast.className = 'toast';
  }, 3000);
}

function renderHeaders(headers) {
  headersBody.innerHTML = '';
  headers.forEach((h, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-idx="${idx}" data-k="name" type="text" value="${h.name || ''}"></td>
      <td><input data-idx="${idx}" data-k="value" type="text" value="${h.value || ''}"></td>
      <td><button data-idx="${idx}" data-action="remove">✕</button></td>
    `;
    headersBody.appendChild(tr);
  });
}

function renderProfiles(profiles) {
  profilesEl.innerHTML = '';
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Name</th><th>URL</th><th></th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  profiles.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.profileId = p.id || uuid();

    const tdName = document.createElement('td');
    const inputName = document.createElement('input');
    inputName.dataset.idx = idx;
    inputName.dataset.k = 'name';
    inputName.type = 'text';
    inputName.value = p.name || '';
    inputName.placeholder = 'Webhook name';
    tdName.appendChild(inputName);

    const tdUrl = document.createElement('td');
    const inputUrl = document.createElement('input');
    inputUrl.dataset.idx = idx;
    inputUrl.dataset.k = 'url';
    inputUrl.type = 'text';
    inputUrl.value = p.url || '';
    inputUrl.placeholder = 'https://...';
    tdUrl.appendChild(inputUrl);

    const tdTest = document.createElement('td');
    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test';
    testBtn.dataset.idx = idx;
    testBtn.dataset.action = 'test-webhook';
    testBtn.type = 'button';
    tdTest.appendChild(testBtn);

    const tdRemove = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.dataset.idx = idx;
    removeBtn.dataset.action = 'remove-profile';
    removeBtn.type = 'button';
    tdRemove.appendChild(removeBtn);

    tr.appendChild(tdName);
    tr.appendChild(tdUrl);
    tr.appendChild(tdTest);
    tr.appendChild(tdRemove);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  profilesEl.appendChild(table);
}

async function load() {
  const s = await loadSettings();
  renderProfiles(s.webhookProfiles && s.webhookProfiles.length ? s.webhookProfiles : (s.webhookUrl ? [{ id: uuid(), name: 'Default', url: s.webhookUrl }] : []));
  payloadMode.value = s.payloadMode || 'plain';
  jsonTemplate.value = s.jsonTemplate || DEFAULT_SETTINGS.jsonTemplate;
  stripParams.value = (s.stripParams || DEFAULT_SETTINGS.stripParams).join(',');
  useCanonical.checked = !!s.useCanonical;
  includeSelection.checked = !!s.includeSelection;
  includeOgData.checked = !!s.includeOgData;
  showNotifications.checked = s.showNotifications !== false;
  hmacSecret.value = s.hmacSecret || '';
  renderHeaders(s.customHeaders || []);
}

function currentHeaders() {
  const rows = Array.from(headersBody.querySelectorAll('tr'));
  return rows.map((tr) => {
    const inputs = tr.querySelectorAll('input');
    return { name: inputs[0].value.trim(), value: inputs[1].value };
  }).filter(h => h.name);
}

function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

async function save() {
  const profiles = Array.from(profilesEl.querySelectorAll('tbody tr')).map(tr => {
    const inputs = tr.querySelectorAll('input');
    const existingId = tr.dataset.profileId;
    return { id: existingId || uuid(), name: inputs[0].value.trim(), url: inputs[1].value.trim() };
  }).filter(p => p.name && p.url);

  // Validate webhook URLs
  for (const profile of profiles) {
    if (!isValidWebhookUrl(profile.url)) {
      setToast(`Invalid URL: ${profile.name}`, true);
      return;
    }
  }

  // Check for duplicate names
  const names = profiles.map(p => p.name.toLowerCase());
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    setToast(`Duplicate webhook name: ${duplicateNames[0]}`, true);
    return;
  }

  // Check for duplicate URLs
  const urls = profiles.map(p => p.url.toLowerCase());
  const duplicateUrls = urls.filter((url, index) => urls.indexOf(url) !== index);
  if (duplicateUrls.length > 0) {
    setToast('Duplicate webhook URL found. Each webhook must have a unique URL.', true);
    return;
  }

  // Validate HMAC secret if provided
  const secret = hmacSecret.value.trim();
  if (secret && secret.length < 16) {
    setToast('HMAC secret should be at least 16 characters for security', true);
    return;
  }

  const s = {
    webhookUrl: '',
    webhookProfiles: profiles,
    payloadMode: payloadMode.value,
    jsonTemplate: jsonTemplate.value,
    stripParams: stripParams.value.split(',').map(x => x.trim()).filter(Boolean),
    useCanonical: useCanonical.checked,
    includeSelection: includeSelection.checked,
    includeOgData: includeOgData.checked,
    showNotifications: showNotifications.checked,
    customHeaders: currentHeaders(),
    hmacSecret: secret || null
  };
  await saveSettings(s);
  setToast('Saved');
}

headersBody.addEventListener('input', (e) => {
  // live updates not persisted until Save
});

headersBody.addEventListener('click', (e) => {
  const target = e.target;
  if (target.tagName === 'BUTTON' && target.dataset.action === 'remove') {
    const idx = Number(target.dataset.idx);
    const rows = Array.from(headersBody.querySelectorAll('tr'));
    rows[idx].remove();
  }
});

addHeader.addEventListener('click', () => {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input data-k="name" type="text" placeholder="X-Custom"></td>
    <td><input data-k="value" type="text" placeholder="value"></td>
    <td><button data-action="remove">✕</button></td>
  `;
  headersBody.appendChild(tr);
});

saveBtn.addEventListener('click', save);

addProfileBtn.addEventListener('click', () => {
  const tbody = profilesEl.querySelector('tbody');
  if (!tbody) {
    renderProfiles([{ id: uuid(), name: '', url: '' }]);
    return;
  }
  const tr = document.createElement('tr');
  tr.dataset.profileId = uuid();

  const tdName = document.createElement('td');
  const inputName = document.createElement('input');
  inputName.dataset.k = 'name';
  inputName.type = 'text';
  inputName.placeholder = 'Webhook name';
  tdName.appendChild(inputName);

  const tdUrl = document.createElement('td');
  const inputUrl = document.createElement('input');
  inputUrl.dataset.k = 'url';
  inputUrl.type = 'text';
  inputUrl.placeholder = 'https://...';
  tdUrl.appendChild(inputUrl);

  const tdTest = document.createElement('td');
  const testBtn = document.createElement('button');
  testBtn.textContent = 'Test';
  testBtn.dataset.action = 'test-webhook';
  testBtn.type = 'button';
  tdTest.appendChild(testBtn);

  const tdRemove = document.createElement('td');
  const removeBtn = document.createElement('button');
  removeBtn.textContent = '✕';
  removeBtn.dataset.action = 'remove-profile';
  removeBtn.type = 'button';
  tdRemove.appendChild(removeBtn);

  tr.appendChild(tdName);
  tr.appendChild(tdUrl);
  tr.appendChild(tdTest);
  tr.appendChild(tdRemove);
  tbody.appendChild(tr);
});

profilesEl.addEventListener('click', async (e) => {
  const target = e.target;
  if (target.tagName === 'BUTTON' && target.dataset.action === 'remove-profile') {
    target.closest('tr')?.remove();
  }
  if (target.tagName === 'BUTTON' && target.dataset.action === 'test-webhook') {
    const tr = target.closest('tr');
    const urlInput = tr.querySelector('input[data-k="url"]');
    const url = urlInput?.value.trim();
    if (!url) {
      alert('Please enter a webhook URL first');
      return;
    }

    target.disabled = true;
    target.textContent = 'Testing...';

    const td = target.parentElement;
    let testResultSpan = td.querySelector('.test-result');
    if (!testResultSpan) {
      testResultSpan = document.createElement('span');
      testResultSpan.className = 'test-result';
      td.appendChild(testResultSpan);
    }
    testResultSpan.className = 'test-result loading';
    testResultSpan.textContent = 'Sending test request...';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'test://webhook',
        signal: controller.signal
      });
      clearTimeout(timeout);
      const txt = await res.text().catch(() => '');

      if (res.ok) {
        testResultSpan.className = 'test-result success';
        testResultSpan.textContent = `✓ Success - HTTP ${res.status}${txt ? ': ' + txt.slice(0, 60) : ''}`;
      } else {
        testResultSpan.className = 'test-result error';
        testResultSpan.textContent = `✗ Failed - HTTP ${res.status}${txt ? ': ' + txt.slice(0, 60) : ''}`;
      }
    } catch (err) {
      testResultSpan.className = 'test-result error';
      const errMsg = String(err);
      if (errMsg.includes('aborted')) {
        testResultSpan.textContent = '✗ Timeout - Request took longer than 10 seconds';
      } else {
        testResultSpan.textContent = `✗ Error: ${errMsg.slice(0, 100)}`;
      }
    } finally {
      target.disabled = false;
      target.textContent = 'Test';
    }
  }
});

testAllBtn.addEventListener('click', async () => {
  const s = await loadSettings();
  const profiles = s.webhookProfiles || [];
  if (profiles.length === 0) {
    alert('No webhooks to test');
    return;
  }

  testAllBtn.disabled = true;
  testAllBtn.textContent = 'Testing...';

  let successCount = 0;
  let failCount = 0;

  for (const profile of profiles) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(profile.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'test://webhook-batch',
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) successCount++;
      else failCount++;
    } catch {
      failCount++;
    }
  }

  testAllBtn.disabled = false;
  testAllBtn.textContent = 'Test All Webhooks';
  alert(`Test Results:\n✓ Success: ${successCount}\n✗ Failed: ${failCount}`);
});

exportBtn.addEventListener('click', async () => {
  const settings = await loadSettings();
  const dataStr = JSON.stringify(settings, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `url-to-n8n-settings-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setToast('Settings exported');
});

importBtn.addEventListener('click', () => {
  importFile.click();
});

importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const settings = JSON.parse(text);

    // Basic validation
    if (!settings || typeof settings !== 'object') {
      throw new Error('Invalid settings file');
    }

    await saveSettings(settings);
    setToast('Settings imported successfully');
    setTimeout(() => location.reload(), 1000);
  } catch (err) {
    setToast(`Import failed: ${err.message}`, true);
  }

  importFile.value = '';
});

// Load version from manifest
chrome.runtime.getManifest && (versionEl.textContent = `v${chrome.runtime.getManifest().version}`);

load();


