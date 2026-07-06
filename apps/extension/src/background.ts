/** service worker：可选的角标计数，显示 relay 里有几份待上传草稿。 */
import { DEFAULT_RELAY_BASE } from './xsession.js';

async function updateBadge(): Promise<void> {
  try {
    const res = await fetch(`${DEFAULT_RELAY_BASE}/drafts`);
    if (!res.ok) throw new Error(String(res.status));
    const items: Array<{ status?: string; kind?: string }> = await res.json();
    const n = items.filter((d) => d.status !== 'done' && (d.kind ?? 'x-article') === 'x-article').length;
    await chrome.action.setBadgeText({ text: n ? String(n) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
  } catch {
    await chrome.action.setBadgeText({ text: '' });
  }
}

function ensureAlarm(): void {
  chrome.alarms.create('kaitox-poll', { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  updateBadge();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'kaitox-poll') updateBadge();
});
