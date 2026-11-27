import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG as c,
  createState,
  checkIn,
  checkOut,
  joinQueue,
  leaveQueue,
  tick,
  queueEtas,
  publicState,
  SchedulerError,
} from '../src/scheduler.js';

const MIN = 60_000;
const T0 = new Date(2026, 10, 24, 8, 0).getTime();
const id = (n) => `client-${String(n).padStart(4, '0')}`;
const basic = { ...c, advancedScheduling: false };
const TOPUP = 'convenience';
const NEED = 'required';

function fullOffice(t = [T0, T0, T0], needs = [NEED, TOPUP, NEED]) {
  const s = createState(c, T0);
  ['A', 'B', 'C'].forEach((name, i) => checkIn(s, { clientId: id(i + 1), name, chargerId: i + 1, need: needs[i] }, t[i], c));
  return s;
}
const join = (s, n, name, need, at = T0, cfg = c, extra = {}) => joinQueue(s, { clientId: id(n), name, need, ...extra }, at, cfg);

test('checking in and joining need a name and a charge type', () => {
  const s = createState(c, T0);
  assert.throws(() => checkIn(s, { clientId: id(1), name: 'A', chargerId: 1 }, T0, c), /Top-up.*get home/);
  assert.throws(() => checkIn(s, { clientId: id(1), name: 'A', chargerId: 1, need: 'urgent' }, T0, c), /Top-up/);
  assert.throws(() => checkIn(s, { clientId: id(1), name: ' ', chargerId: 1, need: TOPUP }, T0, c), /name/);
  checkIn(s, { clientId: id(1), name: 'A', chargerId: 1, need: TOPUP }, T0, c);
  assert.equal(s.chargers[0].session.need, TOPUP);
  assert.throws(() => checkIn(s, { clientId: id(9), name: 'X', chargerId: 1, need: TOPUP }, T0, c), /in use/);
  assert.throws(() => join(s, 1, 'A', TOPUP), /already charging/);
});

test('nobody is asked to swap during the guaranteed time', () => {
  const s = fullOffice();
  const events = join(s, 4, 'D', NEED, T0 + 30 * MIN);
  assert.equal(events.filter((e) => e.type === 'swap-request').length, 0);
});

test('after the guaranteed time, a top-up is asked to swap before a required charge', () => {
  const s = fullOffice();
  join(s, 4, 'D', NEED, T0 + 30 * MIN);
  const req = tick(s, T0 + 121 * MIN, c).filter((e) => e.type === 'swap-request');
  assert.deepEqual(req.map((e) => [e.name, e.forName]), [['B', 'D']]);
});

test('among equals, whoever plugged in earliest swaps first; over the maximum time goes first of all', () => {
  const s = fullOffice([T0, T0 + 60 * MIN, T0 + 120 * MIN], [NEED, TOPUP, TOPUP]);
  join(s, 4, 'D', NEED, T0 + 200 * MIN);
  assert.equal(s.chargers.find((ch) => ch.session.swapRequestedAt).session.name, 'B', 'earliest top-up, not the required charge');
  const s2 = fullOffice([T0, T0 + 60 * MIN, T0 + 120 * MIN], [NEED, TOPUP, TOPUP]);
  join(s2, 4, 'D', NEED, T0 + 241 * MIN);
  assert.equal(s2.chargers.find((ch) => ch.session.swapRequestedAt).session.name, 'A', 'over 4 hours goes first even if required');
});

test('someone who needs it to get home only gives way to someone else who does, until the maximum time', () => {
  // A and C need it to get home, B is a top-up. Everyone is past the guaranteed time.
  const s = fullOffice();
  join(s, 4, 'D', TOPUP, T0 + 30 * MIN);
  join(s, 5, 'E', TOPUP, T0 + 31 * MIN);
  const asked = () => s.chargers.filter((ch) => ch.session?.swapRequestedAt).map((ch) => [ch.session.name, ch.session.swapFor]);
  tick(s, T0 + 150 * MIN, c);
  assert.deepEqual(asked(), [['B', 'D']], 'two top-ups waiting can only displace the one top-up');

  join(s, 6, 'F', NEED, T0 + 151 * MIN);
  assert.deepEqual(asked().sort(), [['A', 'F'], ['B', 'D']], 'a required charge can displace a required charge after the guaranteed time');

  tick(s, T0 + 241 * MIN, c);
  assert.deepEqual(asked().sort(), [['A', 'F'], ['B', 'D'], ['C', 'E']], 'over the maximum time, anyone gives way');
});

test('a required swap request is withdrawn when the person who needed it leaves', () => {
  const s = fullOffice([T0, T0, T0], [NEED, NEED, NEED]);
  join(s, 4, 'D', NEED, T0 + 10 * MIN);
  join(s, 5, 'E', TOPUP, T0 + 11 * MIN);
  tick(s, T0 + 130 * MIN, c);
  assert.equal(s.chargers.filter((ch) => ch.session.swapRequestedAt).length, 1);
  const events = leaveQueue(s, { clientId: id(4), id: s.queue.find((q) => q.name === 'D').id }, T0 + 131 * MIN, c);
  assert.ok(events.some((e) => e.type === 'swap-cancelled'), 'a top-up waiting does not justify it');
  assert.equal(s.chargers.filter((ch) => ch.session.swapRequestedAt).length, 0);
});

test('required charges go to the front of the queue; basic mode is first come, first served', () => {
  const s = fullOffice();
  join(s, 4, 'D', TOPUP, T0);
  join(s, 5, 'E', NEED, T0 + 1);
  assert.deepEqual(s.queue.map((e) => e.name), ['E', 'D']);
  const b = fullOffice();
  join(b, 4, 'D', TOPUP, T0, basic);
  join(b, 5, 'E', NEED, T0 + 1, basic);
  assert.deepEqual(b.queue.map((e) => e.name), ['D', 'E']);
  assert.equal(tick(b, T0 + 300 * MIN, basic).filter((e) => e.type === 'swap-request').length, 0, 'nobody is asked to swap in basic mode');
});

test('turning advanced scheduling off cancels outstanding swap requests', () => {
  const s = fullOffice();
  join(s, 4, 'D', NEED);
  tick(s, T0 + 121 * MIN, c);
  const events = tick(s, T0 + 122 * MIN, basic);
  assert.equal(events.filter((e) => e.type === 'swap-cancelled').length, 1);
  assert.ok(s.chargers.every((ch) => !ch.session.swapRequestedAt));
});

test('a freed charger is not reserved: the queue head is alerted, but whoever checks in first gets it', () => {
  const s = fullOffice();
  join(s, 4, 'D', TOPUP, T0 + 10 * MIN);
  join(s, 5, 'E', NEED, T0 + 11 * MIN);
  const events = checkOut(s, { clientId: id(2), chargerId: 2 }, T0 + 20 * MIN, c);
  assert.deepEqual(events.filter((e) => e.type === 'charger-free'), [{ type: 'charger-free', chargerId: 2, name: 'E', clientId: id(5), email: null }]);
  assert.equal(publicState(s, T0, c).chargers[1].status, 'free');
  assert.equal(tick(s, T0 + 21 * MIN, c).length, 0, 'the alert is sent once');
  checkIn(s, { clientId: id(4), name: 'D', chargerId: 2, need: TOPUP }, T0 + 22 * MIN, c);
  assert.equal(s.chargers[1].session.name, 'D');
  assert.deepEqual(s.queue.map((e) => e.name), ['E']);
  assert.equal(s.queue[0].alert, null, 'alert cleared once the charger is taken');
});

test('a freed charger stays free indefinitely and anyone can check in', () => {
  const s = fullOffice();
  join(s, 4, 'D', TOPUP);
  checkOut(s, { clientId: id(1), chargerId: 1 }, T0 + 5 * MIN, c);
  tick(s, T0 + 180 * MIN, c);
  assert.equal(s.queue[0].alert.chargerId, 1);
  checkIn(s, { clientId: id(9), name: 'Walk-up', chargerId: 1, need: TOPUP }, T0 + 181 * MIN, c);
  assert.equal(s.chargers[0].session.name, 'Walk-up');
});

test('swap requests are cancelled when the queue empties', () => {
  const s = fullOffice();
  join(s, 4, 'D', NEED);
  tick(s, T0 + 121 * MIN, c);
  const events = leaveQueue(s, { clientId: id(4), id: s.queue[0].id }, T0 + 122 * MIN, c);
  assert.equal(events.filter((e) => e.type === 'swap-cancelled').length, 1);
  assert.ok(s.chargers.every((ch) => !ch.session.swapRequestedAt));
});

test('only the owner can check out unless forced', () => {
  const s = fullOffice();
  assert.throws(() => checkOut(s, { clientId: id(9), chargerId: 1 }, T0, c), (e) => e instanceof SchedulerError && e.status === 403);
  assert.equal(checkOut(s, { clientId: id(9), chargerId: 1, force: true }, T0, c)[0].type, 'freed');
});

test('ETAs use the guaranteed time, and raw client ids are never published', () => {
  const s = fullOffice();
  join(s, 4, 'D', TOPUP, T0 + 30 * MIN);
  join(s, 5, 'E', TOPUP, T0 + 31 * MIN);
  join(s, 6, 'F', TOPUP, T0 + 32 * MIN);
  join(s, 7, 'G', TOPUP, T0 + 33 * MIN);
  const etas = queueEtas(s, T0 + 30 * MIN, c);
  assert.deepEqual(s.queue.map((e) => (etas[e.id] - T0) / MIN), [120, 120, 120, 240]);
  const pub = publicState(s, T0, c, (x) => `tag-${x}`);
  assert.equal(pub.queue[0].owner, `tag-${id(4)}`);
  assert.equal(pub.queue[0].need, TOPUP);
  assert.ok(!JSON.stringify(pub).includes(`"${id(4)}"`));
});

test('you can add someone else to the queue and manage their place', () => {
  const s = fullOffice();
  join(s, 1, 'Dev', NEED, T0, c, { forSomeoneElse: true });
  const entry = s.queue[0];
  assert.notEqual(entry.clientId, id(1));
  assert.equal(entry.addedBy, id(1));
  assert.throws(() => join(s, 2, 'dev', TOPUP, T0, c, { forSomeoneElse: true }), /already/);
  assert.throws(() => leaveQueue(s, { clientId: id(2), id: entry.id }, T0, c), /someone else/);
  leaveQueue(s, { clientId: id(1), id: entry.id }, T0, c);
  assert.equal(s.queue.length, 0);
});

test('the person who added someone can check them in, keeping their charge type', () => {
  const s = fullOffice();
  join(s, 1, 'Dev', NEED, T0, c, { forSomeoneElse: true });
  join(s, 9, 'Zed', TOPUP, T0 + 1);
  checkOut(s, { clientId: id(2), chargerId: 2 }, T0 + 5 * MIN, c);
  const dev = s.queue.find((e) => e.name === 'Dev');
  assert.throws(() => checkIn(s, { clientId: id(9), entryId: dev.id, chargerId: 2 }, T0, c), /only check in people you added/);
  checkIn(s, { clientId: id(1), entryId: dev.id, chargerId: 2 }, T0 + 6 * MIN, c);
  const session = s.chargers[1].session;
  assert.deepEqual([session.name, session.need, session.addedBy], ['Dev', NEED, id(1)]);
  assert.deepEqual(s.queue.map((e) => e.name), ['Zed'], "the adder's own queue entries are untouched");
  assert.equal(checkOut(s, { clientId: id(1), chargerId: 2 }, T0 + 40 * MIN, c)[0].type, 'checkout');
});

test('someone who was added leaves the queue when they check in on their own phone', () => {
  const s = fullOffice();
  join(s, 1, 'Dev', NEED, T0, c, { forSomeoneElse: true, email: 'dev@example.com' });
  checkOut(s, { clientId: id(3), chargerId: 3 }, T0 + 5 * MIN, c);
  checkIn(s, { clientId: id(8), name: 'dev', chargerId: 3, need: NEED }, T0 + 6 * MIN, c);
  assert.equal(s.chargers[2].session.clientId, id(8));
  assert.equal(s.chargers[2].session.email, 'dev@example.com');
  assert.equal(s.queue.length, 0);
});

test('email follows you from the queue to the charger, is in events, and is never published', () => {
  const s = fullOffice();
  join(s, 4, 'D', TOPUP, T0, c, { email: 'd@example.com' });
  const events = checkOut(s, { clientId: id(2), chargerId: 2 }, T0 + MIN, c);
  assert.equal(events.find((e) => e.type === 'charger-free').email, 'd@example.com');
  checkIn(s, { clientId: id(4), name: 'D', chargerId: 2, need: TOPUP }, T0 + 2 * MIN, c);
  assert.equal(s.chargers[1].session.email, 'd@example.com');
  const pub = JSON.stringify(publicState(s, T0, c));
  assert.ok(!pub.includes('d@example.com'));
  assert.ok(pub.includes('"hasEmail":true'));
  assert.throws(() => join(s, 7, 'X', TOPUP, T0, c, { email: 'nope' }), /valid email/);
});

test('emails are ignored when email is disabled, and adding others can be switched off', () => {
  const s = fullOffice();
  const off = { ...c, emailEnabled: false, allowProxy: false };
  join(s, 4, 'D', TOPUP, T0, off, { email: 'd@example.com' });
  assert.equal(s.queue[0].email, null);
  assert.throws(() => join(s, 4, 'G', TOPUP, T0, off, { forSomeoneElse: true }), /turned off/);
});

test('the queue is capped (default 6) in both basic and advanced mode', () => {
  const s = fullOffice();
  assert.equal(s.chargers.filter((ch) => ch.session).length, 3, 'people charging do not count towards the cap');
  for (let i = 0; i < 6; i++) join(s, 10 + i, `Q${i}`, TOPUP, T0 + i);
  assert.throws(() => join(s, 20, 'Late', TOPUP), /queue is full \(6 waiting\)/);
  assert.throws(() => join(s, 10, 'Guest', TOPUP, T0, c, { forSomeoneElse: true }), /queue is full/, 'adding someone else also respects the cap');
  assert.throws(() => join(s, 20, 'Late', TOPUP, T0, basic), /queue is full/);
});

test('sessions saved before charge types existed are treated as top-ups', () => {
  const s = fullOffice();
  delete s.chargers[0].session.need;
  assert.equal(publicState(s, T0, c).chargers[0].session.need, TOPUP);
});
