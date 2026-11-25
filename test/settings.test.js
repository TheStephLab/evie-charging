import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/scheduler.js';
import { cleanSettings, defaultSettings, effectiveConfig, loadSettings, publicFeatures } from '../src/settings.js';

const base = DEFAULT_CONFIG;

test('advanced features are off by default', () => {
  const s = defaultSettings(base);
  assert.ok(Object.values(s.features).every((v) => v === false));
  const cfg = effectiveConfig(base, s, { smtp: true });
  assert.equal(cfg.advancedScheduling, false);
  assert.equal(cfg.allowProxy, false);
  assert.equal(cfg.emailEnabled, false);
});

test('email is only enabled when SMTP is configured', () => {
  const s = cleanSettings({ features: { emailNotifications: true } }, defaultSettings(base));
  assert.equal(publicFeatures(s, { smtp: false }).email, false);
  assert.equal(publicFeatures(s, { smtp: true }).email, true);
});

test('settings are validated and unknown keys ignored', () => {
  const cur = defaultSettings(base);
  assert.throws(() => cleanSettings({ tuning: { swapGraceMinutes: 0 } }, cur), /between 5 and 60/);
  assert.throws(() => cleanSettings({ tuning: { minSessionMinutes: 200, maxSessionMinutes: 100 } }, cur), /at least/);
  const next = cleanSettings({ features: { advancedScheduling: 'yes', evil: true }, tuning: { swapGraceMinutes: '20' } }, cur);
  assert.equal(next.features.advancedScheduling, false, 'only literal true enables a flag');
  assert.equal(next.features.evil, undefined);
  assert.equal(next.tuning.swapGraceMinutes, 20);
  assert.deepEqual(loadSettings({ tuning: { swapGraceMinutes: -1 } }, base), cur, 'corrupt stored settings fall back to defaults');
});
