'use strict';

// =============================================================================
// In-app dialogs — drop-in replacements for window.alert / confirm / prompt
// that render as branded modals inside the app instead of native browser
// popups. Each is async and returns a Promise; Esc cancels (alert: closes,
// confirm: false, prompt: null) and Enter confirms.
//
//   appAlert(message, opts)               → Promise<void>
//   appConfirm(message, opts)             → Promise<boolean>
//   appPrompt(message, defaultValue, opts) → Promise<string | null>
//
// opts (all optional):
//   { title, confirmLabel, cancelLabel, okLabel, placeholder, danger }
//
// `danger: true` paints the primary action red so destructive choices read
// as such (delete-story / delete-sheet / clear-layer all set this).
//
// Focus is trapped inside the dialog while it's open and restored to the
// previously-focused element when it closes (uses trapFocusIn / release
// from a11y.js).
// =============================================================================

let _dialogContainer = null;

function _ensureDialogContainer() {
  if (_dialogContainer) return _dialogContainer;
  const c = document.createElement("div");
  c.className = "app-dialog hidden";
  c.id = "app-dialog";
  c.setAttribute("role", "dialog");
  c.setAttribute("aria-modal", "true");
  // Click on the backdrop = cancel. The dialog window itself swallows the
  // event so an inside click doesn't close.
  c.addEventListener("pointerdown", (e) => {
    if (e.target === c && _dialogContainer._cancelHandler) {
      _dialogContainer._cancelHandler();
    }
  });
  document.body.appendChild(c);
  _dialogContainer = c;
  return c;
}

function _showDialog({ title, message, fields, buttons }) {
  return new Promise((resolve) => {
    const c = _ensureDialogContainer();
    c.innerHTML = "";

    const win = document.createElement("div");
    win.className = "app-dialog-window";
    win.addEventListener("pointerdown", (e) => e.stopPropagation());

    if (title) {
      const h = document.createElement("div");
      h.className = "app-dialog-title";
      h.textContent = title;
      win.appendChild(h);
    }

    const body = document.createElement("div");
    body.className = "app-dialog-body";
    if (message) {
      // Multi-paragraph support: split on blank lines so messages keep the
      // shape they had as a `\n\n`-separated alert string.
      const paragraphs = String(message).split(/\n\n+/);
      for (const para of paragraphs) {
        const p = document.createElement("p");
        p.className = "app-dialog-message";
        p.textContent = para;
        body.appendChild(p);
      }
    }

    const inputs = [];
    if (fields) {
      for (const f of fields) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "app-dialog-input";
        input.value = f.defaultValue || "";
        if (f.placeholder) input.placeholder = f.placeholder;
        input.autocomplete = "off";
        input.spellcheck = false;
        body.appendChild(input);
        inputs.push(input);
      }
    }
    win.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";
    const buttonEls = [];
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.className = "app-dialog-btn"
        + (b.primary ? " primary" : "")
        + (b.danger ? " danger" : "");
      btn.textContent = b.label;
      btn.addEventListener("click", () => {
        finish(b.value);
      });
      actions.appendChild(btn);
      buttonEls.push(btn);
    }
    win.appendChild(actions);
    c.appendChild(win);
    c.classList.remove("hidden");

    function finish(buttonValue) {
      c.classList.add("hidden");
      c.innerHTML = "";
      _dialogContainer._cancelHandler = null;
      releaseFocusTrap();
      document.removeEventListener("keydown", onKey, true);
      const fieldValues = inputs.length ? inputs.map((i) => i.value) : null;
      resolve({ button: buttonValue, fields: fieldValues });
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        const cancel = buttons.find((b) => b.cancel);
        if (cancel) finish(cancel.value);
      } else if (e.key === "Enter") {
        const target = e.target;
        if (target && target.tagName === "TEXTAREA") return;
        e.preventDefault();
        const primary = buttons.find((b) => b.primary) || buttons[buttons.length - 1];
        finish(primary.value);
      }
    }
    document.addEventListener("keydown", onKey, true);

    // Backdrop-click cancel handler.
    _dialogContainer._cancelHandler = () => {
      const cancel = buttons.find((b) => b.cancel);
      if (cancel) finish(cancel.value);
    };

    trapFocusIn(win);
    if (inputs.length) {
      // Prompt-style: focus the first input and select its contents so the
      // user can immediately type a replacement.
      inputs[0].focus();
      inputs[0].select();
    } else {
      const primaryIdx = buttons.findIndex((b) => b.primary);
      const target = primaryIdx >= 0 ? buttonEls[primaryIdx] : buttonEls[buttonEls.length - 1];
      if (target) target.focus();
    }
  });
}

function appAlert(message, opts = {}) {
  return _showDialog({
    title: opts.title || "Easy Draft",
    message,
    buttons: [
      { label: opts.okLabel || "OK", value: true, primary: true, cancel: true },
    ],
  }).then(() => undefined);
}

function appConfirm(message, opts = {}) {
  return _showDialog({
    title: opts.title || "Easy Draft",
    message,
    buttons: [
      { label: opts.cancelLabel || "Cancel", value: false, cancel: true },
      { label: opts.confirmLabel || "OK", value: true, primary: true, danger: !!opts.danger },
    ],
  }).then((r) => r.button);
}

function appPrompt(message, defaultValue = "", opts = {}) {
  return _showDialog({
    title: opts.title || "Easy Draft",
    message,
    fields: [{ defaultValue, placeholder: opts.placeholder }],
    buttons: [
      { label: opts.cancelLabel || "Cancel", value: false, cancel: true },
      { label: opts.confirmLabel || "OK", value: true, primary: true },
    ],
  }).then((r) => (r.button ? r.fields[0] : null));
}
