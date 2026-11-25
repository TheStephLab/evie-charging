// Shared application shell: app bar, navigation rail / mobile navigation dialog,
// appearance (System / Light / Dark) menu and dialog light-dismiss.
const $ = (sel, root = document) => root.querySelector(sel);

export function enableDialogLightDismiss(dialog) {
  let startedOutside = false;
  const outside = (e) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom;
  };
  dialog.addEventListener('pointerdown', (e) => {
    startedOutside = e.isPrimary && e.button === 0 && e.target === dialog && outside(e);
  });
  dialog.addEventListener('pointercancel', () => (startedOutside = false));
  dialog.addEventListener('close', () => (startedOutside = false));
  dialog.addEventListener('click', (e) => {
    const dismiss = startedOutside && e.target === dialog && outside(e);
    startedOutside = false;
    if (dismiss) {
      e.preventDefault();
      e.stopPropagation();
      dialog.close();
    }
  });
}

function initNavigation() {
  const mobile = matchMedia('(max-width: 760px)');
  const toggle = $('#navigation-toggle');
  const dialog = $('#navigation-dialog');
  const nav = document.createElement('div');
  for (const n of document.querySelectorAll('.rail nav, .rail .rail-label')) nav.append(n.cloneNode(true));
  $('#mobile-navigation').append(nav);

  const update = () => {
    if (!mobile.matches && dialog.open) dialog.close();
    toggle.setAttribute('aria-controls', mobile.matches ? 'navigation-dialog' : 'navigation-rail');
    toggle.setAttribute(
      'aria-expanded',
      String(mobile.matches ? dialog.open : !document.body.classList.contains('nav-collapsed')),
    );
  };
  toggle.addEventListener('click', () => {
    if (mobile.matches) dialog.showModal();
    else document.body.classList.toggle('nav-collapsed');
    update();
  });
  $('[data-close-navigation]').addEventListener('click', () => dialog.close());
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) dialog.close();
  });
  dialog.addEventListener('close', update);
  mobile.addEventListener('change', update);
  update();
}

// Highlights the rail item for the section currently in view.
function initActiveSection() {
  const links = [...document.querySelectorAll('.section-nav a[href^="#"]')];
  const sections = [...new Set(links.map((a) => a.getAttribute('href')))]
    .map((h) => document.querySelector(h)?.closest('section'))
    .filter(Boolean);
  if (!sections.length) return;
  const setActive = (id) => {
    for (const a of links) {
      const on = a.getAttribute('href') === `#${id}`;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.querySelector('h2')?.id);
    },
    { rootMargin: '-80px 0px -55% 0px' },
  );
  sections.forEach((s) => io.observe(s));
  setActive(sections[0].querySelector('h2')?.id);
}

function initAppearance() {
  const menu = $('#appearance-menu');
  const trigger = $('[popovertarget="appearance-menu"]');
  menu.addEventListener('toggle', (e) => trigger.setAttribute('aria-expanded', String(e.newState === 'open')));
  menu.addEventListener('change', (e) => {
    if (e.target.name === 'theme') window.evieAppearance.setPreference(e.target.value);
  });
  const update = () => {
    const { preference, effective } = window.evieAppearance.getState();
    menu.querySelectorAll('input[name="theme"]').forEach((i) => (i.checked = i.value === preference));
    $('#theme-current').textContent =
      preference === 'system' ? `System (${effective === 'dark' ? 'dark' : 'light'})` : preference === 'dark' ? 'Dark' : 'Light';
  };
  window.addEventListener('evie-theme-change', update);
  update();
}

export function initShell() {
  initNavigation();
  initAppearance();
  initActiveSection();
  document.querySelectorAll('dialog').forEach(enableDialogLightDismiss);
}
