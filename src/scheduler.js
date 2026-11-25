// EVIE scheduling core: pure, synchronous state transitions.
// Every mutation takes (state, input, now, config), mutates state and returns
// a list of domain events (used for notifications/webhooks).

const MIN = 60_000;
const HOUR = 3_600_000;

export const DEFAULT_CONFIG = Object.freeze({
  chargers: 3,
  chargerKw: 7,
  milesPerKwh: 3.5,
  minSessionMinutes: 120, // guaranteed charging time before anyone can ask you to swap
  maxSessionMinutes: 240, // after this you're first in line to swap if someone is waiting
  offerMinutes: 15, // time a queued person has to plug in once a charger is offered
  swapGraceMinutes: 15, // expected time to unplug after a swap request
  urgentRangeMiles: 30, // queue entries below this range jump ahead of non-urgent ones
  maxQueue: 6, // advanced scheduling: waiting-list cap (6 = 2 waiting per charger, 3 people per charger in total)
  // Policy switches (the app maps feature flags onto these):
  advancedScheduling: true, // guaranteed time, need-based swap requests, low-range priority; off = plain FIFO
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

export const milesPerHour = (c) => c.chargerKw * c.milesPerKwh;

const nextId = (state, prefix) => `${prefix}${++state.seq}`;

function cleanName(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!s) throw new SchedulerError('Please enter your name.');
  return s;
}

function cleanMiles(v, label) {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n) || n < 0 || n > 1000) {
    throw new SchedulerError(`${label} must be between 0 and 1000 miles.`);
  }
  return Math.round(n);
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

function cleanRanges(input) {
  const currentRange = cleanMiles(input.currentRange, 'Current range');
  const targetRange = cleanMiles(input.targetRange, 'Target range');
  if (targetRange <= currentRange) {
    throw new SchedulerError('Target range must be higher than your current range.');
  }
  return { currentRange, targetRange };
}

function getCharger(state, id) {
  const ch = state.chargers.find((c) => c.id === Number(id));
  if (!ch) throw new SchedulerError('Unknown charger.', 404);
  return ch;
}

const offerFor = (state, chargerId) => state.queue.find((e) => e.offer?.chargerId === chargerId);
const chargerOf = (state, clientId) => state.chargers.find((c) => c.session?.clientId === clientId);
// The person themselves, or whoever added them on their behalf.
const canManage = (rec, clientId) => rec.clientId === clientId || rec.addedBy === clientId;
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
export const MAX_ADDED_PER_PERSON = 3;

export function sessionInfo(s, now, c) {
  const rate = milesPerHour(c);
  const est = s.reportedRange + (Math.max(0, now - s.reportedAt) / HOUR) * rate;
  const reachTargetAt = s.reportedAt + (Math.max(0, s.targetRange - s.reportedRange) / rate) * HOUR;
  const protectedUntil = s.startedAt + c.minSessionMinutes * MIN;
  const maxUntil = s.startedAt + c.maxSessionMinutes * MIN;
  return {
    estRange: Math.round(est),
    remaining: Math.max(0, Math.round(s.targetRange - est)),
    reachedTarget: now >= reachTargetAt,
    reachTargetAt,
    protectedUntil,
    maxUntil,
    eligibleAt: Math.min(protectedUntil, reachTargetAt),
    overMax: now >= maxUntil,
  };
}

const queueOrder = (a, b) => Number(b.urgent) - Number(a.urgent) || a.joinedAt - b.joinedAt;

// Who should give up their charger first: over the max time, then already at target,
// then whoever needs the fewest additional miles, then whoever plugged in earliest.
const swapOrder = (a, b) =>
  Number(b.info.overMax) - Number(a.info.overMax) ||
  Number(b.info.reachedTarget) - Number(a.info.reachedTarget) ||
  a.info.remaining - b.info.remaining ||
  a.s.startedAt - b.s.startedAt;

export function checkIn(state, input, now, c) {
  const clientId = cleanClient(input.clientId);
  let name = cleanName(input.name);
  const { currentRange, targetRange } = cleanRanges(input);
  const email = cleanEmail(input.email, c);
  const ch = getCharger(state, input.chargerId);
  if (ch.session) throw new SchedulerError(`Charger ${ch.id} is already in use by ${ch.session.name}.`, 409);
  const reserved = offerFor(state, ch.id);
  let owner = clientId;
  let addedBy = null;
  if (reserved && reserved.clientId !== clientId) {
    if (reserved.addedBy === clientId) {
      // Checking in someone you added to the queue.
      owner = reserved.clientId;
      addedBy = clientId;
      name = reserved.name;
    } else if (!(reserved.addedBy && sameName(reserved.name, name))) {
      throw new SchedulerError(`Charger ${ch.id} is reserved for ${reserved.name}. Please join the queue.`, 409);
    }
    // else: the added person arrived and checked in on their own device.
  }
  if (owner === clientId && chargerOf(state, clientId)) {
    throw new SchedulerError('You are already checked in to a charger.', 409);
  }
  const previous = state.queue.find((e) => e.clientId === owner);
  state.queue = state.queue.filter((e) => e !== reserved && e.clientId !== owner);
  ch.session = {
    id: nextId(state, 's'),
    clientId: owner,
    addedBy,
    name,
    email: email ?? reserved?.email ?? previous?.email ?? null,
    startedAt: now,
    startRange: currentRange,
    reportedRange: currentRange,
    reportedAt: now,
    targetRange,
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

export function updateSession(state, input, now, c) {
  const clientId = cleanClient(input.clientId);
  const ch = getCharger(state, input.chargerId);
  const s = ch.session;
  if (!s) throw new SchedulerError(`Charger ${ch.id} is free.`, 409);
  if (!canManage(s, clientId)) throw new SchedulerError("That's someone else's session.", 403);
  const { currentRange, targetRange } = cleanRanges({
    currentRange: input.currentRange,
    targetRange: input.targetRange ?? s.targetRange,
  });
  Object.assign(s, { reportedRange: currentRange, reportedAt: now, targetRange });
  return [{ type: 'update', chargerId: ch.id, name: s.name }, ...tick(state, now, c)];
}

export function joinQueue(state, input, now, c) {
  const clientId = cleanClient(input.clientId);
  const name = cleanName(input.name);
  const { currentRange, targetRange } = cleanRanges(input);
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
  if (adv(c) && c.maxQueue > 0 && state.queue.length >= c.maxQueue) {
    throw new SchedulerError(`The queue is full (${c.maxQueue} waiting). Please try again when someone has had their turn.`, 409);
  }
  state.queue.push({
    id: nextId(state, 'q'),
    clientId: proxy ? nextId(state, 'guest-') : clientId,
    addedBy: proxy ? clientId : null,
    name,
    email,
    currentRange,
    targetRange,
    joinedAt: now,
    urgent: currentRange < c.urgentRangeMiles,
    offer: null,
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

  state.queue = state.queue.filter((e) => {
    if (e.offer && now >= e.offer.expiresAt) {
      events.push({ type: 'offer-expired', chargerId: e.offer.chargerId, name: e.name, clientId: e.clientId });
      return false;
    }
    return true;
  });
  state.queue.sort(adv(c) ? queueOrder : (a, b) => a.joinedAt - b.joinedAt);

  for (const ch of state.chargers) {
    if (ch.session || offerFor(state, ch.id)) continue;
    const next = state.queue.find((e) => !e.offer);
    if (!next) break;
    next.offer = { chargerId: ch.id, offeredAt: now, expiresAt: now + c.offerMinutes * MIN };
    events.push({ type: 'offer', chargerId: ch.id, name: next.name, clientId: next.clientId, email: next.email ?? null });
  }

  const waiting = state.queue.filter((e) => !e.offer);
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

  // Cancel surplus swap requests (most recent first) if the queue shrank.
  const requested = active
    .filter((ch) => ch.session.swapRequestedAt)
    .sort((a, b) => b.session.swapRequestedAt - a.session.swapRequestedAt);
  let surplus = requested.length - waiting.length;
  for (const ch of requested) {
    if (surplus-- <= 0) break;
    ch.session.swapRequestedAt = null;
    ch.session.swapFor = null;
    events.push({ type: 'swap-cancelled', chargerId: ch.id, name: ch.session.name, clientId: ch.session.clientId });
  }

  const stillRequested = active.filter((ch) => ch.session.swapRequestedAt).length;
  const needed = waiting.length - stillRequested;
  if (needed > 0) {
    const candidates = active
      .filter((ch) => !ch.session.swapRequestedAt)
      .map((ch) => ({ ch, s: ch.session, info: sessionInfo(ch.session, now, c) }))
      .filter(({ info }) => now >= info.eligibleAt)
      .sort(swapOrder)
      .slice(0, needed);
    candidates.forEach(({ ch, s }, i) => {
      const forName = waiting[stillRequested + i]?.name ?? null;
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
    });
  }

  return events;
}

// Rough ETA for each queue entry: simulate chargers freeing up at their earliest swap time
// (advanced) or when each driver should reach their target (basic).
export function queueEtas(state, now, c) {
  const rate = milesPerHour(c);
  const full = (need) => (Math.max(0, need) / rate) * HOUR;
  const hold = (need) => (adv(c) ? Math.min(c.minSessionMinutes * MIN, full(need)) : full(need));
  const free = state.chargers.map((ch) => {
    if (ch.session) {
      if (ch.session.swapRequestedAt) return now;
      const info = sessionInfo(ch.session, now, c);
      return Math.max(now, adv(c) ? info.eligibleAt : info.reachTargetAt);
    }
    const o = offerFor(state, ch.id);
    return o ? now + hold(o.targetRange - o.currentRange) : now;
  });
  const etas = {};
  for (const e of state.queue) {
    if (e.offer) {
      etas[e.id] = now;
      continue;
    }
    const i = free.indexOf(Math.min(...free));
    etas[e.id] = free[i];
    free[i] += hold(e.targetRange - e.currentRange);
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
      const offer = offerFor(state, ch.id);
      return {
        id: ch.id,
        status: s ? (s.swapRequestedAt ? 'swap' : 'charging') : offer ? 'reserved' : 'free',
        session: s && {
          id: s.id,
          owner: tag(s.clientId),
          addedBy: tagOrNull(s.addedBy),
          name: s.name,
          hasEmail: Boolean(s.email),
          startedAt: s.startedAt,
          startRange: s.startRange,
          targetRange: s.targetRange,
          swapRequestedAt: s.swapRequestedAt,
          swapFor: s.swapFor,
          ...sessionInfo(s, now, c),
        },
        reservedFor: offer && {
          id: offer.id,
          owner: tag(offer.clientId),
          addedBy: tagOrNull(offer.addedBy),
          name: offer.name,
          expiresAt: offer.offer.expiresAt,
        },
      };
    }),
    queue: state.queue.map((e, i) => ({
      id: e.id,
      owner: tag(e.clientId),
      addedBy: tagOrNull(e.addedBy),
      name: e.name,
      currentRange: e.currentRange,
      targetRange: e.targetRange,
      hasEmail: Boolean(e.email),
      joinedAt: e.joinedAt,
      urgent: adv(c) && e.urgent,
      offer: e.offer,
      position: i + 1,
      eta: etas[e.id],
    })),
  };
}
