// Team chat webhooks: Microsoft Teams (Workflows / Adaptive Card) or plain {"text"} (Slack, Google Chat…).
import net from 'node:net';
import { SettingsError } from './settings.js';

export const WEBHOOK_FORMATS = ['auto', 'teams', 'text'];
const TEAMS_HOST = /(^|\.)(logic\.azure\.com|powerplatform\.com|powerautomate\.com|webhook\.office\.com)$/i;

// The URL is a secret (anyone holding it can post to the channel), so it's validated strictly.
export function cleanWebhookUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new SettingsError('Paste the webhook URL.');
  if (raw.length > 2048) throw new SettingsError('That URL is too long.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SettingsError("That doesn't look like a URL.");
  }
  if (url.protocol !== 'https:') throw new SettingsError('The webhook URL must start with https://');
  if (url.username || url.password) throw new SettingsError('The webhook URL must not contain a username or password.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) || host === 'localhost' || /\.(local|localhost|internal|lan)$/i.test(host) || !host.includes('.')) {
    throw new SettingsError('The webhook URL must use a public host name.');
  }
  return url.href;
}

export function cleanWebhookFormat(value) {
  const f = String(value ?? 'auto');
  if (!WEBHOOK_FORMATS.includes(f)) throw new SettingsError('Unknown message format.');
  return f;
}

export const detectFormat = (url) => (TEAMS_HOST.test(new URL(url).hostname) ? 'teams' : 'text');
export const resolveFormat = (url, format) => (format === 'teams' || format === 'text' ? format : detectFormat(url));

// Shows enough to recognise the URL without revealing its signature.
export function maskUrl(url) {
  const u = new URL(url);
  const tail = url.replace(/[^A-Za-z0-9]/g, '').slice(-4);
  return `${u.protocol}//${u.hostname}/…${tail}`;
}

export function buildPayload(format, { title, text, link }) {
  if (format === 'teams') {
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
              ...(text ? [{ type: 'TextBlock', text, wrap: true }] : []),
            ],
            ...(link ? { actions: [{ type: 'Action.OpenUrl', title: 'Open EVIE', url: link }] } : {}),
          },
        },
      ],
    };
  }
  return { text: [title, text, link].filter(Boolean).join('\n') };
}

export async function postWebhook({ url, format }, message, { timeoutMs = 8000 } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildPayload(resolveFormat(url, format), message)),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.status;
}
