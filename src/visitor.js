// Visitor centre content: fixed sections of free-text fields that a site admin fills in from Settings.
// Shared by the server and the browser (demo mode). Blank fields render as "ask at reception".

export const VISITOR_SECTIONS = [
  {
    id: 'safety',
    title: 'Safety and emergencies',
    fields: [
      { key: 'fireExits', label: 'Fire exits', hint: 'Where the nearest fire exits are, by floor or area.' },
      { key: 'assemblyPoint', label: 'Fire assembly point', hint: 'Where to go when the alarm sounds.' },
      { key: 'firstAid', label: 'First aid', hint: 'Where the first aid kits are and how to find a first aider.' },
      { key: 'defibrillator', label: 'Defibrillator (AED)', hint: 'Where the nearest defibrillator is.' },
      { key: 'emergencyContacts', label: 'Site emergency contacts', hint: 'Security, facilities or reception numbers.' },
    ],
  },
  {
    id: 'onsite',
    title: 'On site',
    fields: [
      { key: 'reception', label: 'Reception', hint: 'Where reception is and its opening hours.' },
      { key: 'wifi', label: 'Guest Wi-Fi', hint: 'Network name and how to get access.' },
      { key: 'toilets', label: 'Toilets', hint: 'Including accessible toilets.' },
      { key: 'parking', label: 'Parking', hint: 'Visitor spaces and any rules.' },
      { key: 'accessibility', label: 'Accessibility', hint: 'Step-free access, lifts, hearing loops.' },
      { key: 'food', label: 'Food and drink', hint: 'Café, kitchens, water.' },
    ],
  },
];

export const VISITOR_FIELDS = VISITOR_SECTIONS.flatMap((s) => s.fields);
export const MAX_FIELD_LENGTH = 1000;
export const DEMO_VISITOR_KEY = 'evie.demo.visitor';

export class VisitorError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export const emptyVisitor = () => ({ fields: Object.fromEntries(VISITOR_FIELDS.map((f) => [f.key, ''])), updatedAt: null });

// Validates untrusted input. Unknown keys are dropped; text is kept as plain text (escaped when shown).
export function cleanVisitor(input, now = Date.now()) {
  const out = emptyVisitor();
  for (const f of VISITOR_FIELDS) {
    const v = input?.fields?.[f.key];
    if (v == null) continue;
    const s = String(v).replace(/\r\n?/g, '\n').trim();
    if (s.length > MAX_FIELD_LENGTH) throw new VisitorError(`${f.label} must be ${MAX_FIELD_LENGTH} characters or fewer.`);
    out.fields[f.key] = s;
  }
  out.updatedAt = now;
  return out;
}

export function loadVisitor(stored) {
  try {
    return stored ? { ...cleanVisitor(stored, stored.updatedAt ?? null) } : emptyVisitor();
  } catch {
    return emptyVisitor();
  }
}
