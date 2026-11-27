// EVIE scheduling core: pure, synchronous state transitions.
// Every mutation takes (state, input, now, config), mutates state and returns
// a list of domain events (used for notifications/webhooks).
//
// People don't enter their range. They say what kind of charge it is:
//   'convenience' — a top-up, happy to swap if someone needs it
//   'required'    — needed to get home safely

const MIN = 60_000;

export const NEEDS = Object.freeze(['convenience', 'required']);

export const DEFAULT_CONFIG = Object.freeze({
  chargers: 3,
  minSessionMinutes: 120, // guaranteed charging time before anyone can ask you to swap
  maxSessionMinutes: 240, // after this you're first in line to swap if someone is waiting
  swapGraceMinutes: 15, // expected time to unplug after a swap request
  maxQueue: 6, // max people waiting to charge; people already charging don't count
  // Policy switches (the app maps feature flags onto these):
  advancedScheduling: true, // guaranteed time, swap requests, required-charge priority; off = plain FIFO
  allowProxy: true, // allow adding someone else to the queue
  emailEnabled: true, // accept and keep optional email addresses for alerts
});

const adv = (c) => c.advancedScheduling !== false;

export class SchedulerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function createState(config, now) {
  return {
    day: dayKey(now),
    seq: 0,
    chargers: Array.from({ length: config.chargers }, (_, i) => ({ id: i + 1, session: null })),
    queue: [],
  };
}

const nextId = (state, prefix) => `${prefix}${++state.seq}`;

function cleanName(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!s) throw new SchedulerError('Please enter your name.');
  return s;
}

function cleanNeed(v) {
  if (!NEEDS.includes(v)) throw new SchedulerError('Choose "Top-up" or "Need it to get home".');
  return v;
}

function cleanEmail(v, c) {
  if (!c.emailEnabled || v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (s.length > 254 || !/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/.test(s)) {
    throw new SchedulerError('Please enter a valid email address, or leave it blank.');
  }
  return s;
}

function cleanClient(v) {
  const s = String(v ?? '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) throw new SchedulerError('Missing or invalid client id.');
  return s;
}

function getCharger(state, id) {
  const ch = state.chargers.find((c) => c.id === Number(id));
  if (!ch) throw new SchedulerError('Unknown charger.', 404);
  return ch;
}

const chargerOf = (state, clientId) => state.chargers.find((c) => c.session?.clientId === clientId);
// The person themselves, or whoever added them on their behalf.
const canManage = (rec, clientId) => rec.clientId === clientId || rec.addedBy === clientId;
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const needOf = (rec) => (rec.need === 'required' ? 'required' : 'convenience');
export const MAX_ADDED_PER_PERSON = 3;

export function sessionInfo(s, now, c) {
  const protectedUntil = s.startedAt + c.minSessionMinutes * MIN;
  const maxUntil = s.startedAt + c.maxSessionMinutes * MIN;
  return { protectedUntil, maxUntil, eligibleAt: protectedUntil, overMax: now >= maxUntil };
}

// Advanced scheduling: required charges are served first, then first come, first served.
const queueOrder = (a, b) => Number(needOf(b) === 'required') - Number(needOf(a) === 'required') || a.joinedAt - b.joinedAt;

// Who should give up their charger first: anyone over the maximum time, then top-ups
// before required charges, then whoever plugged in earliest.
const swapOrder = (a, b) =>
  Number(b.info.overMax) - Number(a.info.overMax) ||
  Number(needOf(a.s) === 'required') - Number(needOf(b.s) === 'required') ||
  a.s.startedAt - b.s.startedAt;

export function checkIn(state, input, now, c) {
  const clientId = cleanClient(input.clientId);
  const ch = getCharger(state, input.chargerId);
  // No reservations: a free charger belongs to whoever plugs in and checks in first.
  if (ch.session) throw new SchedulerError(`Charger ${ch.id} is already in use by ${ch.session.name}.`, 409);

  let owner = clientId;
  let addedBy = null;
  let entry = null;
  let name;
  let need;
  if (input.entryId) {
    // Checking in someone you added to the queue.
    entry = state.queue.find((e) => e.id === input.entryId);
    if (!entry) throw new SchedulerError('That person is no longer in the queue.', 404);
    if (entry.addedBy !== clientId) throw new SchedulerError('You can only check in people you added.', 403);
    owner = entry.clientId;
    addedBy = clientId;
    name = entry.name;
    need = input.need ? cleanNeed(input.need) : needOf(entry);
  } else {
    name = cleanName(input.name);
    need = cleanNeed(input.need);
    if (chargerOf(state, clientId)) throw new SchedulerError('You are already checked in to a charger.', 409);
    entry =
      state.queue.find((e) => e.clientId === clientId) ??
      // Someone a colleague queued for them has arrived and checked in on their own phone.
      state.queue.find((e) => e.addedBy && sameName(e.name, name));
  }
  const email = cleanEmail(input.email, c);
  state.queue = state.queue.filter((e) => e !== entry && e.clientId !== owner);
  ch.session = {
    id: nextId(state, 's'),
    clientId: owner,
    addedBy,
    name,
    need,
    email: email ?? entry?.email ?? null,
    startedAt: now,
    swapRequestedAt: null,
    swapFor: null,
  };
  return [{ type: 'checkin', chargerId: ch.id, name }, ...tick(state, now, c)];
}

export function checkOut(state, input, now, c) {
  const clientId = cleanClient(input.clientId);
  const ch = getCharger(state, input.chargerId);
  const s = ch.session;
  if (!s) throw new SchedulerError(`Charger ${ch.id} is already free.`, 409);
  const forced = !canManage(s, clientId);
  if (forced && !input.force) throw new SchedulerError("That's someone else's session.", 403);
  ch.session = null;
  return [{ type: forced ? 'freed' : 'checkout', chargerId: ch.id, name: s.name }, ...tick(state, now, c)];
}

export function joinQueue(state, input, now, c) {
  const clientId = cleanClient(input.clientId);
  const name = cleanName(input.name);
  const need = cleanNeed(input.need);
  const email = cleanEmail(input.email, c);
  const proxy = Boolean(input.forSomeoneElse);
  if (proxy && c.allowProxy === false) throw new SchedulerError('Adding someone else to the queue is turned off.', 403);
  if (proxy) {
    const busy =
      state.queue.some((e) => sameName(e.name, name)) || state.chargers.some((ch) => ch.session && sameName(ch.session.name, name));
    if (busy) throw new SchedulerError(`${name} is already charging or in the queue.`, 409);
    if (state.queue.filter((e) => e.addedBy === clientId).length >= MAX_ADDED_PER_PERSON) {
      throw new SchedulerError(`You can add up to ${MAX_ADDED_PER_PERSON} people to the queue.`, 429);
    }
  } else {
    if (chargerOf(state, clientId)) throw new SchedulerError('You are already charging.', 409);
    if (state.queue.some((e) => e.clientId === clientId)) throw new SchedulerError('You are already in the queue.', 409);
  }
  if (c.maxQueue > 0 && state.queue.length >= c.maxQueue) {
    throw new SchedulerError(`The queue is full (${c.maxQueue} waiting). Please try again when someone has had their turn.`, 409);
  }
  state.queue.push({
    id: nextId(state, 'q'),
    clientId: proxy ? nextId(state, 'guest-') : clientId,
    addedBy: proxy ? clientId : null,
    name,
    need,
    email,
    joinedAt: now,
    alert: null,
  });
  return [{ type: 'join', name }, ...tick(state, now, c)];
}

export function leaveQueue(state, input, now, c) {
  const clientId = cleanClient(input.clientId);
  const entry = state.queue.find((e) => e.id === input.id);
  if (!entry) throw new SchedulerError('Queue entry not found.', 404);
  if (!canManage(entry, clientId) && !input.force) throw new SchedulerError("That's someone else's place in the queue.", 403);
  state.queue = state.queue.filter((e) => e !== entry);
  return [{ type: 'leave', name: entry.name }, ...tick(state, now, c)];
}

// Reconcile state with the rules. Idempotent; called after every mutation and on a timer.
export function tick(state, now, c) {
  const events = [];
  state.queue.sort(adv(c) ? queueOrder : (a, b) => a.joinedAt - b.joinedAt);

  // Free chargers aren't reserved, but the people at the front of the queue are told about them
  // (one person per free charger). Whoever checks in first gets it.
  const freeIds = state.chargers.filter((ch) => !ch.session).map((ch) => ch.id);
  const used = new Set();
  state.queue.forEach((e, i) => {
    if (i >= freeIds.length) {
      e.alert = null;
      return;
    }
    const keep = e.alert && freeIds.includes(e.alert.chargerId) && !used.has(e.alert.chargerId);
    const chargerId = keep ? e.alert.chargerId : freeIds.find((id) => !used.has(id));
    used.add(chargerId);
    if (!e.alert) {
      events.push({ type: 'charger-free', chargerId, name: e.name, clientId: e.clientId, email: e.email ?? null });
    }
    e.alert = { chargerId, at: e.alert?.at ?? now };
  });

  // People not covered by a free charger.
  const waiting = state.queue.slice(freeIds.length);
  const active = state.chargers.filter((ch) => ch.session);

  // Basic mode: plain first-come-first-served, nobody is ever asked to swap.
  if (!adv(c)) {
    for (const ch of active.filter((x) => x.session.swapRequestedAt)) {
      ch.session.swapRequestedAt = null;
      ch.session.swapFor = null;
      events.push({ type: 'swap-cancelled', chargerId: ch.id, name: ch.session.name, clientId: ch.session.clientId });
    }
    return events;
  }

  // Who to ask to swap. Anyone past their guaranteed time can be asked, but someone who needs
  // their charge to get home only gives way to someone else who needs it to get home, unless
  // they're over the maximum time. Existing requests are kept where still justified (oldest first).
  const pool = active
    .map((ch) => ({ ch, s: ch.session, info: sessionInfo(ch.session, now, c) }))
    .filter(({ s, info }) => s.swapRequestedAt || now >= info.eligibleAt);
  const rank = (a, b) =>
    a.s.swapRequestedAt && b.s.swapRequestedAt
      ? a.s.swapRequestedAt - b.s.swapRequestedAt
      : Boolean(b.s.swapRequestedAt) - Boolean(a.s.swapRequestedAt) || swapOrder(a, b);
  const anyone = ({ s, info }) => info.overMax || needOf(s) === 'convenience';
  const open = pool.filter(anyone).sort(rank); // can give way to anybody
  const guarded = pool.filter((x) => !anyone(x)).sort(rank); // only for someone who needs it to get home
  const topUps = waiting.filter((w) => needOf(w) !== 'required');
  const required = waiting.filter((w) => needOf(w) === 'required');
  const fromOpen = Math.min(waiting.length, open.length);
  const requiredLeft = required.length - (fromOpen - Math.min(topUps.length, fromOpen));
  const chosenGuarded = guarded.slice(0, Math.max(0, Math.min(guarded.length, requiredLeft)));
  const chosenOpen = open.slice(0, fromOpen);
  const chosen = new Set([...chosenGuarded, ...chosenOpen].map((x) => x.ch));

  for (const { ch, s } of pool) {
    if (!s.swapRequestedAt || chosen.has(ch)) continue;
    s.swapRequestedAt = null;
    s.swapFor = null;
    events.push({ type: 'swap-cancelled', chargerId: ch.id, name: s.name, clientId: s.clientId });
  }

  // Label each request with who it's for: guarded sessions take people who need it to get home.
  const unassigned = [...waiting];
  const take = (s, allowed) => {
    let i = unassigned.findIndex((w) => w.name === s.swapFor && allowed(w));
    if (i === -1) i = unassigned.findIndex(allowed);
    return i === -1 ? null : unassigned.splice(i, 1)[0];
  };
  for (const [list, allowed] of [
    [chosenGuarded, (w) => needOf(w) === 'required'],
    [chosenOpen, () => true],
  ]) {
    for (const { ch, s } of list) {
      const forName = take(s, allowed)?.name ?? null;
      if (s.swapRequestedAt) {
        s.swapFor = forName;
        continue;
      }
      s.swapRequestedAt = now;
      s.swapFor = forName;
      events.push({
        type: 'swap-request',
        chargerId: ch.id,
        name: s.name,
        clientId: s.clientId,
        forName,
        email: s.email ?? null,
        startedAt: s.startedAt,
      });
    }
  }
  return events;
}

// Rough ETA for each queue entry: each charger frees up once its session has had the
// guaranteed time (or straight away if a swap was requested); each person then holds it
// for about the same time.
export function queueEtas(state, now, c) {
  const hold = c.minSessionMinutes * MIN;
  const free = state.chargers.map((ch) => {
    if (!ch.session || ch.session.swapRequestedAt) return now;
    return Math.max(now, sessionInfo(ch.session, now, c).eligibleAt);
  });
  const etas = {};
  for (const e of state.queue) {
    const i = free.indexOf(Math.min(...free));
    etas[e.id] = free[i];
    free[i] += hold;
  }
  return etas;
}

export function publicState(state, now, c, tag = (id) => id) {
  const etas = queueEtas(state, now, c);
  const tagOrNull = (id) => (id ? tag(id) : null);
  return {
    now,
    config: c,
    chargers: state.chargers.map((ch) => {
      const s = ch.session;
      return {
        id: ch.id,
        status: s ? (s.swapRequestedAt ? 'swap' : 'charging') : 'free',
        session: s && {
          id: s.id,
          owner: tag(s.clientId),
          addedBy: tagOrNull(s.addedBy),
          name: s.name,
          need: needOf(s),
          hasEmail: Boolean(s.email),
          startedAt: s.startedAt,
          swapRequestedAt: s.swapRequestedAt,
          swapFor: s.swapFor,
          ...sessionInfo(s, now, c),
        },
      };
    }),
    queue: state.queue.map((e, i) => ({
      id: e.id,
      owner: tag(e.clientId),
      addedBy: tagOrNull(e.addedBy),
      name: e.name,
      need: needOf(e),
      hasEmail: Boolean(e.email),
      joinedAt: e.joinedAt,
      alert: e.alert ?? null,
      position: i + 1,
      eta: etas[e.id],
    })),
  };
}
