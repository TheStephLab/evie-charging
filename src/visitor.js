// Visitor centre content, shared by the server and the browser (demo mode).
// Every field starts with the wording from "Your Cambridge Science Park: 101, Phase One" guide
// (v1, 23 November 2026), plus site updates from Workplace Experience. A site admin can override
// any field from Settings; clearing a field brings the default back.
// Text is plain text with [label](url) links and **bold** (bold at the very start is shown as a headline).

export const GUIDE = 'Phase One guide, 23 Nov 2026';

export const ADDRESS = '101 Cambridge Science Park Rd, Milton Rd, Milton, Cambridge CB4 0FY';

export const LINKS = {
  places: 'https://places.cloud.microsoft/places/',
  placesGuide:
    'https://aveva.sharepoint.com/:b:/r/teams/Comms/EmployeeCommunications/Cambridge%20Office/Supporting%20documents/Microsoft%20Places%20Application%20Support%20Guide%20-%20Welcome%20Pack.pdf?d=w2afa9603b079491282770ac4aa38233a&csf=1&web=1&e=W6eR3e',
  neighbourhoodReps:
    'https://aveva.sharepoint.com/:b:/r/teams/Comms/EmployeeCommunications/Cambridge%20Office/CSP%20Neighbourhood%20representatives.pdf?d=w01db052a382244d180834de3934ea502&csf=1&web=1&e=JOc7UK',
  wpeTicket:
    'https://aveva.service-now.com/esc?id=sc_cat_item&sys_id=290319b51b3bb11035700e1ad34bcb74&table=sc_cat_item&searchTerm=workplace%20experience',
  wpeEmail: 'mailto:WPE.Cambridge@aveva.com',
  googleMaps: 'https://maps.app.goo.gl/gSbUFieeRkdu1kjm7',
  what3words: 'https://what3words.com/flash.menu.torch',
  cambridgeNorth: 'https://www.nationalrail.co.uk/stations/cambridge-north/',
  shuttle: 'https://cambridgesciencepark.co.uk/amenities/shuttle-bus/',
  parkAndRide: 'https://cambridgeparkandride.info/milton.shtml',
  voi: 'https://www.voi.com/city/cambridge',
  sciencePark: 'https://cambridgesciencepark.co.uk/',
  lifeOnPark: 'https://cambridgesciencepark.co.uk/life-on-the-park/',
  parkAmenities: 'https://cambridgesciencepark.co.uk/our-amenities/',
  amenitiesMap: 'https://cambridgesciencepark.co.uk/our-amenities-map/',
  cycleHub: 'https://parkhub.uk/',
};

const WPE = `[Workplace Experience](${LINKS.wpeEmail})`;

export const VISITOR_SECTIONS = [
  {
    id: 'safety',
    title: 'Safety',
    fields: [
      {
        key: 'alarmTest',
        label: 'Fire alarm test',
        hint: 'When the weekly test happens and how long it lasts.',
        default: 'Every Wednesday at 10:30am. The test usually lasts around 10 seconds. If the alarm carries on for longer than that, leave the building.',
      },
      { key: 'assemblyPoint', label: 'Fire assembly point', hint: 'Where to go when the alarm sounds.', default: 'Level 0, multi-storey car park.' },
      {
        key: 'fireExits',
        label: 'Fire exits',
        hint: 'How many exits there are on each floor.',
        default: 'Level 0: 3 fire exits.\nLevel 1: 6 fire exits.\nAlways use the nearest marked exit.',
      },
      { key: 'emergency', label: 'Emergencies', hint: 'Who to call.', default: 'Call 999, then make sure reception is aware.' },
      {
        key: 'firstAid',
        label: 'First aid',
        hint: 'Where the first aid room and kits are.',
        default:
          'The First Aid Room is on Level 1, on the west side of the building, opposite 153 Pembroke and 152 Sensory Room.\nFirst aiders and first aid kit locations are listed on notice boards throughout the building.',
      },
      { key: 'defibrillator', label: 'Defibrillator (AED)', hint: 'Where the nearest defibrillator is.', default: 'Level 0, opposite the IT Hub.' },
      {
        key: 'fireMarshals',
        label: 'Fire marshals',
        hint: 'How to find a fire marshal.',
        default: 'Fire marshal contacts are on notice boards throughout the building.',
      },
    ],
  },
  {
    id: 'access',
    title: 'Access and opening hours',
    fields: [
      { key: 'reception', label: 'Reception', hint: 'Where reception is.', default: 'Level 0. Need help? Visit the team at reception.' },
      {
        key: 'hours',
        label: 'Opening hours',
        hint: 'Core hours, security hours and when the building is closed.',
        default:
          'Core hours: 8am–5pm, Monday to Friday.\nSecurity is on site 7am–7pm. Outside 7am–7pm, access to the restaurant and offices is prohibited.\nFor out-of-hours support, call the number displayed in reception.',
      },
      {
        key: 'entry',
        label: 'Getting in',
        hint: 'Doors, turnstiles and passes.',
        default:
          "The front door and turnstiles are protected by the Verkada access system, and you need to present your card at both.\n**Always swipe in and out, and don't tailgate.** It keeps our live occupancy count as accurate as possible, so fire marshals can account for everyone.",
      },
      {
        key: 'wifi',
        label: 'Guest Wi-Fi',
        hint: 'Network name and how to get access.',
        default: '[How to connect to guest Wi-Fi](https://aveva.oak.com/6a7825f7-f197-4e36-840f-57abb61a8df1)',
      },
    ],
  },
  {
    id: 'arriving',
    title: 'Getting here',
    fields: [
      {
        key: 'driving',
        label: 'Driving',
        hint: 'Address and links for sat-navs and map apps.',
        default: `**${ADDRESS}**\n[Directions in Google Maps](${LINKS.googleMaps})\nwhat3words: [///flash.menu.torch](${LINKS.what3words})`,
      },
      {
        key: 'parking',
        label: 'Car park',
        hint: 'Spaces, barrier times and rules.',
        default: `122 spaces, [3 EV charging bays](charging.html) and 3 accessible bays in Phase One. No dedicated motorcycle parking.\nBarriers are open 7am–7pm, Monday to Friday. Access outside these hours needs prior approval from ${WPE}.`,
      },
      {
        key: 'cycling',
        label: 'Cycling',
        hint: 'Bike parking, sheds and repairs.',
        default: `Nearly 200 bike spaces, in the car park and two secure cycle sheds (fob from ${WPE}). The sheds have a shower block, 45 lockers and basic tools.\nRepairs: [Park Cycle Hub](${LINKS.cycleHub}), next to the Bradfield Centre.`,
      },
      {
        key: 'train',
        label: 'Train',
        hint: 'Nearest station.',
        default: `**Closest train station: [Cambridge North](${LINKS.cambridgeNorth})**\nA 10-minute walk, or take the [Science Park shuttle bus](${LINKS.shuttle}).`,
      },
      {
        key: 'bus',
        label: 'Bus',
        hint: 'Nearest bus stops.',
        default: '**Closest stop: Science Park, on the Guided Busway**\nA 200m walk. There are also bus stops at both ends of the Park.',
      },
      {
        key: 'parkAndRide',
        label: 'Park & Ride',
        hint: 'Nearest Park & Ride.',
        default: `**Closest Park & Ride: [Milton Park & Ride](${LINKS.parkAndRide})**\nAbout 5 minutes away by bus.`,
      },
    ],
  },
  {
    id: 'park',
    title: 'Around the Park',
    fields: [
      {
        key: 'shuttle',
        label: 'Shuttle bus',
        hint: 'The Science Park shuttle.',
        default: `The [Science Park shuttle bus](${LINKS.shuttle}) runs between Cambridge North station and the Park.`,
      },
      {
        key: 'scooters',
        label: 'E-bikes and e-scooters',
        hint: 'Hire schemes nearby.',
        default: `[Voi](${LINKS.voi}) e-bikes and e-scooters are available across north Cambridge.`,
      },
      {
        key: 'aroundPark',
        label: 'Amenities map',
        hint: 'Finding your way around Cambridge Science Park.',
        default: `Use the [Cambridge Science Park amenities map](${LINKS.amenitiesMap}) to find your way around.`,
      },
      {
        key: 'parkAmenities',
        label: 'Park amenities',
        hint: 'Food, shops and services on the Park.',
        default: `See [what's available on the Park](${LINKS.parkAmenities}).`,
      },
      {
        key: 'lifeOnPark',
        label: 'Life on the Park',
        hint: 'News and events on the Park.',
        default: `News and events from [Life on the Park](${LINKS.lifeOnPark}).`,
      },
      {
        key: 'sciencePark',
        label: 'Cambridge Science Park',
        hint: 'The Science Park website.',
        default: `[cambridgesciencepark.co.uk](${LINKS.sciencePark})`,
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
        default: `3 accessible spaces outside the building. Contact ${WPE} to use one.`,
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
      { key: 'itHub', label: 'IT Hub', hint: 'Where to get IT help.', default: 'Level 0, for help with IT and printing.' },
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
// A value that matches the default wording is stored as blank, so it follows future updates.
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

// What to show for each field: the admin's text, or the default wording.
export const visitorText = (data) => Object.fromEntries(VISITOR_FIELDS.map((f) => [f.key, data?.fields?.[f.key] || f.default]));

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Only web, email and same-site page links. Anything else (javascript:, data:…) stays as text.
const SAFE_HREF = /^(?:https?:\/\/[^\s<>]+|mailto:[^\s<>]+|[\w-]+\.html(?:#[\w-]+)?|#[\w-]+)$/i;
export const NEW_TAB_NOTE = '<span class="visually-hidden"> (opens in a new tab)</span>';

// Web links open in a new tab; email and same-site links don't.
const anchor = (href, label) =>
  /^https?:/i.test(href)
    ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}${NEW_TAB_NOTE}</a>`
    : `<a href="${href}">${label}</a>`;

// Plain text → safe HTML: [label](url) links, **bold**, tap-to-call phone numbers and line breaks.
export function richText(text) {
  const links = [];
  return esc(text)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      if (!SAFE_HREF.test(href)) return m;
      links.push(anchor(href, label));
      return `\u0000${links.length - 1}\u0000`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^<strong>/, '<strong class="lead">')
    .replace(/(\+?\d[\d ]{7,}\d)/g, (m) => `<a href="tel:${m.replace(/\s/g, '')}">${m}</a>`)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => links[i])
    .replace(/\n/g, '<br>');
}
