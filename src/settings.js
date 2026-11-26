// Feature flags and tunables, shared by the server and the browser (demo mode).
// Basic EVIE (always on): check in to a charger, and the queue with current/target range.

export const FEATURES = [
  {
    key: 'advancedScheduling',
    label: 'Advanced scheduling',
    description:
      'Guaranteed charging time, need-based swap requests, a maximum session length and low-range queue priority. When off, the queue is first come, first served and nobody is asked to swap.',
  },
  {
    key: 'addSomeoneElse',
    label: 'Add someone else to the queue',
    description: "Lets people queue a colleague. They get that person's alerts and can check them in and out.",
  },
  {
    key: 'browserNotifications',
    label: 'Browser notifications',
    description: 'Lets people subscribe to system notifications (needs HTTPS), and adds sounds and vibration to alerts.',
  },
  {
    key: 'emailNotifications',
    label: 'Email notifications',
    description:
      'Adds an optional email field. EVIE emails people when a charger is ready for them or it is their turn to swap. Addresses are deleted overnight.',
    requires: 'smtp',
  },
  {
    key: 'teamWebhook',
    label: 'Team chat webhook',
    description: 'Posts free-charger alerts and swap requests to a Teams, Slack or Google Chat channel.',
    requires: 'webhook',
  },
];

export const TUNING = [
  { key: 'maxQueue', label: 'Queue limit', unit: 'people waiting', min: 1, max: 50 },
  { key: 'minSessionMinutes', label: 'Guaranteed charging time', unit: 'min', min: 15, max: 480, advanced: true },
  { key: 'maxSessionMinutes', label: 'First to be asked to swap after', unit: 'min', min: 15, max: 720, advanced: true },
  { key: 'swapGraceMinutes', label: 'Time to unplug after a swap request', unit: 'min', min: 5, max: 60, advanced: true },
  { key: 'urgentRangeMiles', label: 'Low-range priority below', unit: 'mi', min: 0, max: 200, advanced: true },
];

// Demo mode (static hosting) keeps settings in this browser. A static site can't keep a secret,
// so the demo token is public. It only shows how the token flow works.
export const DEMO_SETTINGS_KEY = 'evie.demo.settings';
export const DEMO_TOKEN = 'demo';

export const REQUIREMENT_HELP = {
  smtp: 'Needs the EVIE server with SMTP configured (SMTP_HOST, SMTP_FROM…).',
  webhook: 'Add a webhook URL in the Team chat webhook section below.',
};

export class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export function defaultSettings(base) {
  return {
    features: Object.fromEntries(FEATURES.map((f) => [f.key, false])),
    tuning: Object.fromEntries(TUNING.map((t) => [t.key, base[t.key]])),
  };
}

// Validates untrusted input and merges it over the current settings. Unknown keys are ignored.
export function cleanSettings(input, current) {
  const next = structuredClone(current);
  for (const f of FEATURES) {
    const v = input?.features?.[f.key];
    if (v !== undefined) next.features[f.key] = v === true;
  }
  for (const t of TUNING) {
    const raw = input?.tuning?.[t.key];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n < t.min || n > t.max) {
      throw new SettingsError(`${t.label} must be between ${t.min} and ${t.max} ${t.unit}.`);
    }
    next.tuning[t.key] = Math.round(n);
  }
  if (next.tuning.maxSessionMinutes < next.tuning.minSessionMinutes) {
    throw new SettingsError('"First to be asked to swap after" must be at least the guaranteed charging time.');
  }
  return next;
}

// Accepts a possibly stale/partial stored settings object.
export function loadSettings(stored, base) {
  try {
    return cleanSettings(stored ?? {}, defaultSettings(base));
  } catch {
    return defaultSettings(base);
  }
}

export function effectiveConfig(base, settings, caps) {
  const f = settings.features;
  return {
    ...base,
    ...settings.tuning,
    advancedScheduling: f.advancedScheduling,
    allowProxy: f.addSomeoneElse,
    emailEnabled: f.emailNotifications && Boolean(caps.smtp),
  };
}

// What the main page needs to know to show or hide features.
export function publicFeatures(settings, caps) {
  const f = settings.features;
  return {
    advancedScheduling: f.advancedScheduling,
    addSomeoneElse: f.addSomeoneElse,
    browserNotifications: f.browserNotifications,
    email: f.emailNotifications && Boolean(caps.smtp),
  };
}
