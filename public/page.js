// Static information pages: shared shell plus copy-to-clipboard buttons ([data-copy]).
import { initShell } from './shell.js';

initShell();

for (const btn of document.querySelectorAll('[data-copy]')) {
  const label = btn.textContent;
  const status = document.querySelector('[data-copy-status]');
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = `Copy failed: ${btn.dataset.copy}`;
    }
    if (status) status.textContent = btn.textContent;
    setTimeout(() => {
      btn.textContent = label;
      if (status) status.textContent = '';
    }, 2000);
  });
}
