/**
 * The quick-peek dialog for a company.
 *
 * This used to carry its own copy of the profile markup, which had drifted from
 * the in-page detail cards. Both surfaces now render `profileBodyHtml`, so the
 * modal shows exactly what the routed profile page shows -- including the
 * fields one of them used to forget.
 */

import { companyAnchor, profileBodyHtml, profileHeaderHtml } from './profile.js';

/**
 * The element focused before the dialog opened, so focus can be returned to it.
 * Restoring focus is what stops keyboard users being dumped back at the top of
 * the document after closing.
 */
let focusBeforeModal = null;

export function openModal(c) {
  const overlay = document.getElementById('modal');
  focusBeforeModal = document.activeElement || null;
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      ${profileHeaderHtml(c, { heading: 'h2' })}
      <button class="close-btn" type="button" data-action="close-modal" aria-label="Close dialog">&times;</button>
    </div>
    <div class="modal-body">
      ${profileBodyHtml(c)}
      <a class="full-profile-link" href="#${companyAnchor(c)}" data-action="open-profile">
        Open full profile →
      </a>
    </div>
  `;
  overlay.classList.add('open');
  overlay.removeAttribute('hidden');
  // Move focus into the dialog so the next Tab press stays inside it and screen
  // readers announce it.
  const dialog = document.getElementById('modal-content');
  dialog.setAttribute('tabindex', '-1');
  if (typeof dialog.focus === 'function') dialog.focus();
}

export function closeModal() {
  const overlay = document.getElementById('modal');
  overlay.classList.remove('open');
  overlay.setAttribute('hidden', '');
  if (focusBeforeModal && typeof focusBeforeModal.focus === 'function') {
    focusBeforeModal.focus();
  }
  focusBeforeModal = null;
}
