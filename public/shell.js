// Shared page shell: appearance (System / Light / Dark) menu, header scroll state, dialog light-dismiss.
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

function initAppearance() {
  const menu = $('#appearance-menu');
  const trigger = $('[popovertarget="appearance-menu"]');
  if (!menu || !trigger) return;
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

function initHeader() {
  const header = $('.site-header');
  if (!header) return;
  const update = () => header.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

export function initShell() {
  initAppearance();
  initHeader();
  document.querySelectorAll('dialog').forEach(enableDialogLightDismiss);
}
