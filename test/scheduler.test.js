import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG as c,
  createState,
  checkIn,
  checkOut,
  joinQueue,
  leaveQueue,
  updateSession,
  tick,
  queueEtas,
  publicState,
  SchedulerError,
} from '../src/scheduler.js';

const MIN = 60_000;
const T0 = new Date(2026, 10, 24, 8, 0).getTime();
const id = (n) => `client-${String(n).padStart(4, '0')}`;

function fullOffice() {
  const s = createState(c, T0);
  // A needs lots, B needs little, C needs medium.
  checkIn(s, { clientId: id(1), name: 'A', chargerId: 1, currentRange: 20, targetRange: 250 }, T0, c);
  checkIn(s, { clientId: id(2), name: 'B', chargerId: 2, currentRange: 100, targetRange: 180 }, T0, c);
  checkIn(s, { clientId: id(3), name: 'C', chargerId: 3, currentRange: 60, targetRange: 230 }, T0, c);
  return s;
}

test('check-in validates input and occupancy', () => {
  const s = fullOffice();
  assert.throws(() => checkIn(s, { clientId: id(9), name: 'X', chargerId: 1, currentRange: 1, targetRange: 2 }, T0, c), /in use/);
  assert.throws(() => joinQueue(s, { clientId: id(9), name: 'X', currentRange: 100, targetRange: 50 }, T0, c), /higher/);
  assert.throws(() => joinQueue(s, { clientId: id(1), name: 'A', currentRange: 10, targetRange: 50 }, T0, c), /already charging/);
});

test('nobody is asked to swap during the protected window', () => {
  const s = fullOffice();
  const events = joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0 + 30 * MIN, c);
  assert.equal(events.filter((e) => e.type === 'swap-request').length, 0);
  assert.ok(s.chargers.every((ch) => !ch.session.swapRequestedAt));
});

test('after the protected window the person needing the fewest extra miles swaps', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0 + 30 * MIN, c);
  const events = tick(s, T0 + 121 * MIN, c);
  const req = events.filter((e) => e.type === 'swap-request');
  assert.equal(req.length, 1);
  assert.equal(req[0].name, 'B'); // ~31 mi from target vs ~121 (C) and ~181 (A)
  assert.equal(req[0].forName, 'D');
});

test('reaching target makes you eligible to swap before the protected window ends', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0, c);
  updateSession(s, { clientId: id(2), chargerId: 2, currentRange: 175, targetRange: 180 }, T0 + 30 * MIN, c);
  const events = tick(s, T0 + 45 * MIN, c);
  assert.deepEqual(events.filter((e) => e.type === 'swap-request').map((e) => e.name), ['B']);
});

test('max session time takes priority over remaining need', () => {
  const late = createState(c, T0);
  checkIn(late, { clientId: id(1), name: 'Early', chargerId: 1, currentRange: 10, targetRange: 400 }, T0, c);
  checkIn(late, { clientId: id(2), name: 'Later', chargerId: 2, currentRange: 10, targetRange: 400 }, T0 + 60 * MIN, c);
  checkIn(late, { clientId: id(3), name: 'Latest', chargerId: 3, currentRange: 150, targetRange: 400 }, T0 + 120 * MIN, c);
  joinQueue(late, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0 + 241 * MIN, c);
  const s1 = late.chargers.find((ch) => ch.session.swapRequestedAt);
  assert.equal(s1.session.name, 'Early');
});

test('checking out offers the charger to the queue head; others cannot take it', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0 + 10 * MIN, c);
  joinQueue(s, { clientId: id(5), name: 'E', currentRange: 10, targetRange: 150 }, T0 + 11 * MIN, c);
  assert.equal(s.queue[0].name, 'E', 'urgent (low range) entries go first');
  const events = checkOut(s, { clientId: id(2), chargerId: 2 }, T0 + 20 * MIN, c);
  assert.deepEqual(events.find((e) => e.type === 'offer'), { type: 'offer', chargerId: 2, name: 'E', clientId: id(5), email: null });
  assert.throws(
    () => checkIn(s, { clientId: id(4), name: 'D', chargerId: 2, currentRange: 40, targetRange: 150 }, T0 + 21 * MIN, c),
    /reserved for E/,
  );
  checkIn(s, { clientId: id(5), name: 'E', chargerId: 2, currentRange: 10, targetRange: 150 }, T0 + 22 * MIN, c);
  assert.equal(s.queue.length, 1);
  assert.equal(s.chargers[1].session.name, 'E');
});

test('expired offers pass to the next person', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0, c);
  joinQueue(s, { clientId: id(5), name: 'E', currentRange: 40, targetRange: 150 }, T0 + 1, c);
  checkOut(s, { clientId: id(1), chargerId: 1 }, T0 + 5 * MIN, c);
  const events = tick(s, T0 + 21 * MIN, c);
  assert.deepEqual(events.map((e) => e.type), ['offer-expired', 'offer']);
  assert.equal(s.queue[0].name, 'E');
  assert.equal(s.queue[0].offer.chargerId, 1);
});

test('swap requests are cancelled when the queue empties', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0, c);
  tick(s, T0 + 121 * MIN, c);
  const events = leaveQueue(s, { clientId: id(4), id: s.queue[0].id }, T0 + 122 * MIN, c);
  assert.equal(events.filter((e) => e.type === 'swap-cancelled').length, 1);
  assert.ok(s.chargers.every((ch) => !ch.session.swapRequestedAt));
});

test('only the owner can check out unless forced', () => {
  const s = fullOffice();
  assert.throws(() => checkOut(s, { clientId: id(9), chargerId: 1 }, T0, c), (e) => e instanceof SchedulerError && e.status === 403);
  const events = checkOut(s, { clientId: id(9), chargerId: 1, force: true }, T0, c);
  assert.equal(events[0].type, 'freed');
});

test('ETAs respect the guaranteed session time', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0, c);
  const eta = queueEtas(s, T0, c)[s.queue[0].id];
  assert.ok(eta >= T0 + 90 * MIN && eta <= T0 + 120 * MIN, `eta ${(eta - T0) / MIN} min`);
  const pub = publicState(s, T0, c, (x) => `tag-${x}`);
  assert.equal(pub.queue[0].owner, `tag-${id(4)}`);
  assert.ok(!JSON.stringify(pub).includes(`"${id(4)}"`), 'raw client ids are never exposed');
});

test('you can add someone else to the queue and manage their place', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(1), name: 'Dev', currentRange: 40, targetRange: 150, forSomeoneElse: true }, T0, c);
  const entry = s.queue[0];
  assert.notEqual(entry.clientId, id(1));
  assert.equal(entry.addedBy, id(1));
  assert.throws(() => joinQueue(s, { clientId: id(2), name: 'dev', currentRange: 40, targetRange: 150, forSomeoneElse: true }, T0, c), /already/);
  assert.throws(() => leaveQueue(s, { clientId: id(2), id: entry.id }, T0, c), /someone else/);
  leaveQueue(s, { clientId: id(1), id: entry.id }, T0, c);
  assert.equal(s.queue.length, 0);
});

test('the person who added someone can check them in and out', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(1), name: 'Dev', currentRange: 40, targetRange: 150, forSomeoneElse: true }, T0, c);
  joinQueue(s, { clientId: id(9), name: 'Zed', currentRange: 40, targetRange: 150 }, T0 + 1, c);
  checkOut(s, { clientId: id(2), chargerId: 2 }, T0 + 5 * MIN, c);
  checkIn(s, { clientId: id(1), name: 'ignored', chargerId: 2, currentRange: 40, targetRange: 150 }, T0 + 6 * MIN, c);
  const session = s.chargers[1].session;
  assert.equal(session.name, 'Dev');
  assert.equal(session.addedBy, id(1));
  assert.deepEqual(s.queue.map((e) => e.name), ['Zed'], "the adder's own queue entries are untouched");
  updateSession(s, { clientId: id(1), chargerId: 2, currentRange: 60 }, T0 + 30 * MIN, c);
  assert.equal(checkOut(s, { clientId: id(1), chargerId: 2 }, T0 + 40 * MIN, c)[0].type, 'checkout');
});

test('someone who was added can claim their reserved charger from their own phone', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(1), name: 'Dev', currentRange: 40, targetRange: 150, forSomeoneElse: true }, T0, c);
  checkOut(s, { clientId: id(3), chargerId: 3 }, T0 + 5 * MIN, c);
  assert.throws(() => checkIn(s, { clientId: id(8), name: 'Eve', chargerId: 3, currentRange: 1, targetRange: 9 }, T0, c), /reserved for Dev/);
  checkIn(s, { clientId: id(8), name: 'dev', chargerId: 3, currentRange: 40, targetRange: 150 }, T0 + 6 * MIN, c);
  assert.equal(s.chargers[2].session.clientId, id(8));
  assert.equal(s.queue.length, 0);
});

const basic = { ...c, advancedScheduling: false };

test('basic mode: first come first served, nobody is asked to swap', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 100, targetRange: 150 }, T0, basic);
  joinQueue(s, { clientId: id(5), name: 'E', currentRange: 5, targetRange: 150 }, T0 + 1, basic);
  assert.deepEqual(s.queue.map((e) => e.name), ['D', 'E'], 'low range does not jump the queue');
  const events = tick(s, T0 + 300 * MIN, basic);
  assert.equal(events.filter((e) => e.type === 'swap-request').length, 0);
  assert.equal(publicState(s, T0, basic).queue[1].urgent, false);
});

test('turning advanced scheduling off cancels outstanding swap requests', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150 }, T0, c);
  tick(s, T0 + 121 * MIN, c);
  const events = tick(s, T0 + 122 * MIN, basic);
  assert.equal(events.filter((e) => e.type === 'swap-cancelled').length, 1);
  assert.ok(s.chargers.every((ch) => !ch.session.swapRequestedAt));
});

test('email follows you from the queue to the charger, is in events, and is never published', () => {
  const s = fullOffice();
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150, email: 'd@example.com' }, T0, c);
  const events = checkOut(s, { clientId: id(2), chargerId: 2 }, T0 + MIN, c);
  assert.equal(events.find((e) => e.type === 'offer').email, 'd@example.com');
  checkIn(s, { clientId: id(4), name: 'D', chargerId: 2, currentRange: 40, targetRange: 150 }, T0 + 2 * MIN, c);
  assert.equal(s.chargers[1].session.email, 'd@example.com');
  const pub = JSON.stringify(publicState(s, T0, c));
  assert.ok(!pub.includes('d@example.com'));
  assert.ok(pub.includes('"hasEmail":true'));
  assert.throws(() => joinQueue(s, { clientId: id(7), name: 'X', currentRange: 1, targetRange: 9, email: 'nope' }, T0, c), /valid email/);
});

test('emails are ignored when email is disabled, and adding others can be switched off', () => {
  const s = fullOffice();
  const off = { ...c, emailEnabled: false, allowProxy: false };
  joinQueue(s, { clientId: id(4), name: 'D', currentRange: 40, targetRange: 150, email: 'd@example.com' }, T0, off);
  assert.equal(s.queue[0].email, null);
  assert.throws(
    () => joinQueue(s, { clientId: id(4), name: 'G', currentRange: 40, targetRange: 150, forSomeoneElse: true }, T0, off),
    /turned off/,
  );
});

test('advanced scheduling caps the queue (default 6), basic mode does not', () => {
  const s = fullOffice();
  for (let i = 0; i < 6; i++) joinQueue(s, { clientId: id(10 + i), name: `Q${i}`, currentRange: 50, targetRange: 150 }, T0 + i, c);
  assert.throws(() => joinQueue(s, { clientId: id(20), name: 'Late', currentRange: 50, targetRange: 150 }, T0, c), /queue is full \(6 waiting\)/);
  assert.throws(
    () => joinQueue(s, { clientId: id(10), name: 'Guest', currentRange: 50, targetRange: 150, forSomeoneElse: true }, T0, c),
    /queue is full/,
    'adding someone else also respects the cap',
  );
  joinQueue(s, { clientId: id(20), name: 'Late', currentRange: 50, targetRange: 150 }, T0, basic);
  assert.equal(s.queue.length, 7);
});
