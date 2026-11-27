// Visitor centre content, shared by the server and the browser (demo mode).
// Every field starts with the wording from "Your Cambridge Science Park: 101, Phase One" guide
// (v1, 23 November 2026). A site admin can override any field from Settings; clearing a field
// brings the guide's wording back. Text is plain text with [label](url) links.

export const GUIDE = 'Phase One guide, 23 Nov 2026';

export const LINKS = {
  places: 'https://places.cloud.microsoft/places/',
  placesGuide:
    'https://aveva.sharepoint.com/:b:/r/teams/Comms/EmployeeCommunications/Cambridge%20Office/Supporting%20documents/Microsoft%20Places%20Application%20Support%20Guide%20-%20Welcome%20Pack.pdf?d=w2afa9603b079491282770ac4aa38233a&csf=1&web=1&e=W6eR3e',
  neighbourhoodReps:
    'https://aveva.sharepoint.com/:b:/r/teams/Comms/EmployeeCommunications/Cambridge%20Office/CSP%20Neighbourhood%20representatives.pdf?d=w01db052a382244d180834de3934ea502&csf=1&web=1&e=JOc7UK',
  wpeTicket:
    'https://aveva.service-now.com/esc?id=sc_cat_item&sys_id=290319b51b3bb11035700e1ad34bcb74&table=sc_cat_item&searchTerm=workplace%20experience',
  wpeEmail: 'mailto:WPE.Cambridge@aveva.com',
  evCommunity:
    'https://teams.microsoft.com/l/channel/19%3AbfFyMcdBYiGXhheWkCTKqo7bi9TJupPhx8xTMJtVPmM1%40thread.tacv2/General?groupId=cd74d2d9-2baf-4ad3-9077-5995cdf30dd2&tenantId=425a5546-5a6e-4f1b-ab62-23d91d07d893',
  verkada: 'https://my.verkada.com/',
  cambridgeNorth: 'https://www.nationalrail.co.uk/stations/cambridge-north/',
  shuttle: 'https://cambridgesciencepark.co.uk/amenities/shuttle-bus/',
  parkAndRide: 'https://cambridgeparkandride.info/milton.shtml',
  voi: 'https://www.voi.com/city/cambridge',
  amenitiesMap: 'https://cambridgesciencepark.co.uk/our-amenities-map/',
  cycleHub: 'https://parkhub.uk/',
};

export const VISITOR_SECTIONS = [
  {
    id: 'safety',
    title: 'Safety',
    fields: [
      {
        key: 'alarmTest',
        label: 'Fire alarm test',
        hint: 'When the weekly test happens.',
        default: "Every Wednesday at 10:30am. You don't need to leave unless the alarm carries on longer than the usual test.",
      },
      {
        key: 'assemblyPoint',
        label: 'Fire assembly point',
        hint: 'Where to go when the alarm sounds.',
        default: 'In the car park. Follow the signs from your nearest exit.',
      },
      {
        key: 'fireExits',
        label: 'Fire exits',
        hint: 'How many exits there are on each floor.',
        default: 'Ground floor (Level 0): 3 fire exits.\nLevel 1: 6 fire exits.\nAlways use the nearest marked exit.',
      },
      { key: 'emergency', label: 'Emergencies', hint: 'Who to call.', default: 'Call 999, then make sure reception is aware.' },
      {
        key: 'firstAid',
        label: 'First aid',
        hint: 'Where the first aid room and kits are.',
        default:
          'The First Aid Room is on Level 1, in the central core by the lifts.\nFirst aiders and first aid kit locations are listed on notice boards throughout the building.',
      },
      { key: 'defibrillator', label: 'Defibrillator (AED)', hint: 'Where the nearest defibrillator is.', default: 'Ground floor, near reception.' },
      {
        key: 'fireMarshals',
        label: 'Fire marshals',
        hint: 'How to find a fire marshal.',
        default: 'Fire marshal contacts are on notice boards throughout the building.',
      },
      {
        key: 'construction',
        label: 'Construction work',
        hint: 'Building work on or near the site.',
        default:
          'Phase Two is still being built. Follow the safety signs, keep out of construction zones, and stay on the marked pavements and walkways.',
      },
      {
        key: 'electrical',
        label: 'Heaters and chargers',
        hint: 'Rules for personal electrical items.',
        default: "Personal heaters aren't allowed. Phone chargers are fine, but please don't leave personal devices charging overnight.",
      },
    ],
  },
  {
    id: 'access',
    title: 'Access and opening hours',
    fields: [
      {
        key: 'reception',
        label: 'Reception',
        hint: 'Where reception is.',
        default: 'Ground floor (Level 0). Need help? Visit the team at reception.',
      },
      {
        key: 'hours',
        label: 'Opening hours',
        hint: 'Core hours and when security is on site.',
        default:
          'Core hours: 8am–5pm, Monday to Friday.\nSecurity is on site 7am–7pm.\nOut of hours, use the support number displayed in reception.',
      },
      {
        key: 'entry',
        label: 'Getting in',
        hint: 'Doors, turnstiles and passes.',
        default: 'The front door and the turnstile are secure. You need your pass at both.',
      },
      {
        key: 'loneWorking',
        label: 'Working early or late',
        hint: 'What to do when working alone.',
        default: 'Working before 7am or after 7pm? Let your line manager and the Workplace Experience team know.',
      },
      { key: 'wifi', label: 'Guest Wi-Fi', hint: 'Network name and how to get access.', default: '' },
    ],
  },
  {
    id: 'arriving',
    title: 'Getting here',
    fields: [
      {
        key: 'parking',
        label: 'Car park',
        hint: 'Spaces, barrier times and rules.',
        default:
          '122 spaces in Phase One, plus 3 EV charging spaces and 3 accessible spaces.\nThe barrier is open 7am–7pm, Monday to Friday. For access outside these hours, ask Workplace Experience for a fob.\nArriving after 9am? Consider parking off site or using public transport.',
      },
      {
        key: 'evCharging',
        label: 'EV charging',
        hint: 'EV spaces and how to share them.',
        default: `3 charging spaces. [Check in on the EV charging page](charging.html) and join the [Cambridge Science Park EV Community](${LINKS.evCommunity}) on Teams.`,
      },
      {
        key: 'motorcycles',
        label: 'Motorcycles',
        hint: 'Where motorcycles park.',
        default: "There's no dedicated motorcycle parking. Please use a standard bay.",
      },
      {
        key: 'cycling',
        label: 'Cycling',
        hint: 'Bike parking, sheds and repairs.',
        default: `Nearly 200 bike spaces, in the car park and two secure cycle sheds. Ask Workplace Experience for a fob for the sheds and the external shower block.\nThe larger shed has the shower block and 45 lockers for semi-permanent storage.\nThe smaller shed has basic tools: a pump, wrenches, Allen keys and screwdrivers.\nRepairs: [Park Cycle Hub](${LINKS.cycleHub}), next to the Bradfield Centre, open 8am–5pm.`,
      },
      {
        key: 'train',
        label: 'Train',
        hint: 'Nearest station.',
        default: `[Cambridge North](${LINKS.cambridgeNorth}) is a 10-minute walk.\nThe [Science Park shuttle bus](${LINKS.shuttle}) runs between the station and the Park.`,
      },
      {
        key: 'bus',
        label: 'Bus and Park & Ride',
        hint: 'Bus stops and Park & Ride.',
        default: `There are bus stops at both ends of the Park, and the main Guided Busway stop is a 200m walk.\n[Milton Park & Ride](${LINKS.parkAndRide}) is about 5 minutes away by bus.`,
      },
      {
        key: 'scooters',
        label: 'E-bikes and e-scooters',
        hint: 'Hire schemes nearby.',
        default: `[Voi](${LINKS.voi}) e-bikes and e-scooters are available across north Cambridge.`,
      },
      {
        key: 'aroundPark',
        label: 'Around the Park',
        hint: 'Finding your way around Cambridge Science Park.',
        default: `Use the [Cambridge Science Park amenities map](${LINKS.amenitiesMap}) to find your way around.`,
      },
    ],
  },
  {
    id: 'accessibility',
    title: 'Accessibility',
    fields: [
      {
        key: 'accessibility',
        label: 'Step-free access',
        hint: 'Entrances, lifts and step-free rooms.',
        default: 'Step-free entrance, with two lifts to every floor.\nSeven phone booths and nine meeting rooms have step-free access.',
      },
      { key: 'hearingLoops', label: 'Hearing loops', hint: 'Where hearing loops are.', default: 'Hearing aid loops are available.' },
      {
        key: 'accessibleParking',
        label: 'Accessible parking',
        hint: 'Accessible spaces and how to use them.',
        default: '3 accessible spaces outside the building. Contact Workplace Experience to use one.',
      },
      {
        key: 'accessibleShowers',
        label: 'Accessible showers',
        hint: 'Accessible showers and changing.',
        default: '3 of the 8 showers are accessible. See [showers and drying areas](facilities.html#showers).',
      },
      {
        key: 'workstation',
        label: 'Workstation set-up',
        hint: 'Display screen equipment (DSE) and ergonomics.',
        default: `New pain or discomfort, or need adjustments moved over from another office? [Raise a Workplace Experience ticket](${LINKS.wpeTicket}).`,
      },
    ],
  },
  {
    id: 'contacts',
    title: 'Who to contact',
    fields: [
      {
        key: 'workplaceExperience',
        label: 'Workplace Experience',
        hint: 'Facilities, fobs, lockers and events.',
        default: `Email [WPE.Cambridge@aveva.com](${LINKS.wpeEmail}) or [raise a support ticket](${LINKS.wpeTicket}).`,
      },
      { key: 'itHub', label: 'IT Hub', hint: 'Where to get IT help.', default: 'Room 001 on the ground floor, for help with IT and printing.' },
      {
        key: 'bookingHelp',
        label: 'Booking help',
        hint: 'Help with desk and room booking.',
        default: `For problems with Microsoft Places, contact the IT Service Desk. See the [Microsoft Places support guide](${LINKS.placesGuide}).`,
      },
      {
        key: 'neighbourhoods',
        label: 'Neighbourhood representatives',
        hint: 'Who looks after each team area.',
        default: `Each team neighbourhood has a representative. [See who they are](${LINKS.neighbourhoodReps}).`,
      },
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

const normalise = (v) => String(v).replace(/\r\n?/g, '\n').trim();

export const emptyVisitor = () => ({ fields: Object.fromEntries(VISITOR_FIELDS.map((f) => [f.key, ''])), updatedAt: null });

// Validates untrusted input. Unknown keys are dropped; text stays plain text (escaped when shown).
// A value that matches the guide's wording is stored as blank, so it follows future guide updates.
export function cleanVisitor(input, now = Date.now()) {
  const out = emptyVisitor();
  for (const f of VISITOR_FIELDS) {
    const v = input?.fields?.[f.key];
    if (v == null) continue;
    const s = normalise(v);
    if (s.length > MAX_FIELD_LENGTH) throw new VisitorError(`${f.label} must be ${MAX_FIELD_LENGTH} characters or fewer.`);
    out.fields[f.key] = s === f.default ? '' : s;
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

// What to show for each field: the admin's text, or the guide's wording.
export const visitorText = (data) => Object.fromEntries(VISITOR_FIELDS.map((f) => [f.key, data?.fields?.[f.key] || f.default]));

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Only web, email and same-site page links. Anything else (javascript:, data:…) stays as text.
const SAFE_HREF = /^(?:https?:\/\/[^\s<>]+|mailto:[^\s<>]+|[\w-]+\.html(?:#[\w-]+)?|#[\w-]+)$/i;

// Plain text → safe HTML: [label](url) links, tap-to-call phone numbers and line breaks.
export function richText(text) {
  const links = [];
  return esc(text)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      if (!SAFE_HREF.test(href)) return m;
      links.push(`<a href="${href}">${label}</a>`);
      return `\u0000${links.length - 1}\u0000`;
    })
    .replace(/(\+?\d[\d ]{7,}\d)/g, (m) => `<a href="tel:${m.replace(/\s/g, '')}">${m}</a>`)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => links[i])
    .replace(/\n/g, '<br>');
}
