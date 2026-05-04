'use strict';

// ==============================================================================
// Accessibility helpers — small utilities that don't fit into a feature file.
//
// trapFocusIn / releaseFocusTrap manage Tab cycling for centered modals so a
// keyboard user doesn't tab out of the dialog into the canvas behind it.
// Inline editor-style popups (dim-modal, line-modal) intentionally do NOT
// use this — they're attached to the selection and the user expects Tab to
// skip them like any other floating tooltip.
// ==============================================================================

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

let _activeFocusTrap = null;

function _focusables(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function trapFocusIn(container) {
  if (!container) return;
  // If a previous trap is still active (modal-on-modal), release it first
  // so the keydown handler stack doesn't leak and Tab keys go to the right
  // container.
  releaseFocusTrap();

  const previouslyFocused = document.activeElement;

  // Always intercept Tab and manually advance through the container's
  // focusables. This avoids depending on browser default tab order, which
  // (a) skips siblings of the focused radio in a radio group and (b) can
  // jump out of the document body in ways that don't reliably fire
  // focusin on the destination element. Manual traversal makes the trap
  // tight regardless of which input types live inside.
  const onTab = (e) => {
    if (e.key !== "Tab") return;
    const items = _focusables(container);
    if (!items.length) { e.preventDefault(); return; }
    e.preventDefault();
    const cur = document.activeElement;
    const idx = items.indexOf(cur);
    if (idx === -1) { items[0].focus(); return; }
    const next = e.shiftKey
      ? (idx - 1 + items.length) % items.length
      : (idx + 1) % items.length;
    items[next].focus();
  };

  // Backstop for non-Tab focus changes (e.g. user clicks a button outside
  // the dialog while the modal's open). Bounce back into the dialog.
  const onDocumentFocusIn = (e) => {
    if (!_activeFocusTrap || _activeFocusTrap.container !== container) return;
    if (container.contains(e.target)) return;
    const items = _focusables(container);
    if (items.length) items[0].focus();
  };

  document.addEventListener("keydown", onTab, true);
  document.addEventListener("focusin", onDocumentFocusIn, true);
  _activeFocusTrap = { container, onTab, onDocumentFocusIn, previouslyFocused };

  if (!container.contains(document.activeElement)) {
    const items = _focusables(container);
    if (items.length) items[0].focus();
  }
}

function releaseFocusTrap() {
  if (!_activeFocusTrap) return;
  const { onTab, onDocumentFocusIn, previouslyFocused } = _activeFocusTrap;
  document.removeEventListener("keydown", onTab, true);
  document.removeEventListener("focusin", onDocumentFocusIn, true);
  _activeFocusTrap = null;
  if (previouslyFocused && typeof previouslyFocused.focus === "function") {
    try { previouslyFocused.focus(); } catch (_) { /* element may be gone */ }
  }
}
