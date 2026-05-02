'use strict';

// ==============================================================================
// Demo mode — boots the app with a pre-saved drawing and a stripped-down UI
// for embedding on the marketing site.
//
// Triggered by ?demo=<name> in the URL. Loaded LAST, after main.js has already
// run init(), so all binders, modals and event handlers are wired by the time
// we get here. We then:
//
//   1. Add `demo-mode` class to <body> (CSS hides chrome we don't need)
//   2. Inject a slim floating toolbar (Select / Wall / Measure / Pan)
//   3. Inject a hint pill + "Open the full editor" CTA
//   4. Block keyboard shortcuts for tools we don't expose
//   5. Fetch demos/<name>.dstudio.json and call loadDocument() on it
//
// When ?demo= is absent (the normal file:// or in-app HTTP case) this script
// does nothing — file:// users never see a regression.
// ==============================================================================

(function () {
  const params = new URLSearchParams(window.location.search);
  const demoName = params.get("demo");
  if (!demoName) return;

  // Whitelist of demo file basenames. Refusing arbitrary input blocks
  // ../../etc/passwd-style paths and accidental 404s if a typo lands.
  const ALLOWED_DEMOS = new Set(["garage", "addition", "bedroom"]);
  const safe = ALLOWED_DEMOS.has(demoName) ? demoName : "garage";

  // Tools available in demo mode. Anything else gets coerced to "select"
  // by the keyboard guard below, and the floating toolbar only exposes
  // these four.
  const DEMO_TOOLS = new Set(["select", "line", "measure", "pan"]);

  document.body.classList.add("demo-mode");

  // ---------- Keyboard guard ----------
  // events.js binds tool shortcuts (V/L/B/T/S/M/H) on window. We capture
  // first and swallow any key that maps to a tool we don't expose. Letting
  // the original handler run on V/L/M/H is fine — those map to allowed tools.
  window.addEventListener("keydown", (e) => {
    if (e.target.matches && e.target.matches("input, select, textarea")) return;
    if (e.ctrlKey || e.metaKey) return;
    const k = (e.key || "").toLowerCase();
    if (k === "b" || k === "t" || k === "s") {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  // ---------- Floating toolbar ----------
  function injectDemoToolbar() {
    const bar = document.createElement("div");
    bar.id = "demo-toolbar";
    bar.innerHTML = `
      <button class="demo-tool active" data-tool="select" title="Select — click a wall or door">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 8-6 2-2 6z"/></svg>
        <span>Select</span>
      </button>
      <button class="demo-tool" data-tool="line" title="Draw a wall">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>
        <span>Wall</span>
      </button>
      <button class="demo-tool" data-tool="measure" title="Add a measurement">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="6" rx="1"/><line x1="7" y1="9" x2="7" y2="12"/><line x1="11" y1="9" x2="11" y2="13"/><line x1="15" y1="9" x2="15" y2="12"/><line x1="19" y1="9" x2="19" y2="13"/></svg>
        <span>Measure</span>
      </button>
      <button class="demo-tool" data-tool="pan" title="Pan / zoom (or hold Space)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5a2 2 0 1 1 4 0v6"/><path d="M13 11V4a2 2 0 1 1 4 0v9"/><path d="M17 9a2 2 0 1 1 4 0v6a7 7 0 0 1-7 7h-2a7 7 0 0 1-6-3.5L3 14a2 2 0 1 1 3-2l2 2"/><path d="M9 11a2 2 0 1 0-4 0v3"/></svg>
        <span>Pan</span>
      </button>
    `;
    document.querySelector(".canvas-wrap").appendChild(bar);

    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".demo-tool");
      if (!btn) return;
      const tool = btn.dataset.tool;
      if (!DEMO_TOOLS.has(tool)) return;
      // setTool lives in the shared classic-script lexical environment, so
      // referencing it here works (it isn't on `window`, but classic scripts
      // share scope — same reason the bind*() calls in main.js can see all
      // their helpers).
      setTool(tool);
      syncDemoToolbar();
    });
  }

  function syncDemoToolbar() {
    const bar = document.getElementById("demo-toolbar");
    if (!bar) return;
    for (const btn of bar.querySelectorAll(".demo-tool")) {
      btn.classList.toggle("active", btn.dataset.tool === state.tool);
    }
  }

  // The base setTool() flips classes on the original .tool buttons in the
  // hidden sidebar. Mirror that to our floating toolbar by polling state.tool
  // on a render tick — the simplest hook that doesn't require modifying
  // events.js. render() is called after every state.tool change, so we
  // piggyback on the existing render() function.
  function patchRenderForToolbarSync() {
    const originalRender = window.render;
    // Top-level `function render()` in render.js lives in the classic-script
    // scope, not on window. We can't override it that way — but we *can*
    // listen to state.tool changes by patching setTool's effect through a
    // MutationObserver on the (hidden) original tool list, which gets its
    // .active class flipped by setTool itself.
    const originalToolList = document.getElementById("tool-list");
    if (!originalToolList) return;
    const obs = new MutationObserver(syncDemoToolbar);
    for (const btn of originalToolList.querySelectorAll(".tool")) {
      obs.observe(btn, { attributes: true, attributeFilter: ["class"] });
    }
  }

  // ---------- Hint pill + full-editor CTA ----------
  function injectDemoChrome() {
    const wrap = document.querySelector(".canvas-wrap");

    const hint = document.createElement("div");
    hint.id = "demo-hint";
    hint.innerHTML = `
      <div class="demo-hint-title">Try it</div>
      <div class="demo-hint-tips">
        <span><b>Click</b> a door &rarr; flip hinge or swing</span>
        <span><b>Click</b> a wall &rarr; change thickness</span>
        <span>Pick <b>Wall</b> or <b>Measure</b> to draw</span>
      </div>
    `;
    wrap.appendChild(hint);

    const cta = document.createElement("a");
    cta.id = "demo-fullcta";
    // Strip ?demo= so clicking opens the unrestricted editor in a new tab.
    cta.href = window.location.pathname;
    cta.target = "_top";
    cta.rel = "noopener";
    cta.textContent = "Open the full editor →";
    wrap.appendChild(cta);
  }

  // ---------- Demo file load ----------
  // True until the visitor has manually panned, zoomed, or set a tool other
  // than "select". While true, every container resize re-runs the fit-to-
  // bounds — that handles the case where init() ran before the iframe had
  // settled its layout (which puts the drawing offset on first paint at full
  // window size). Once the visitor interacts, we stop refitting so a resize
  // doesn't yank their work out from under them.
  let userInteracted = false;

  async function loadDemoFile() {
    try {
      const res = await fetch("demos/" + safe + ".dstudio.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (typeof loadDocument === "function") loadDocument(data);
      // Force the active layer to a non-palette layer (Walls preferred) so
      // the demo's Line / Wall tool actually works. setTool("line") in
      // events.js silently falls back to "select" when the active layer has
      // its own palette (Windows & Doors, Kitchen, Bathroom, etc.) — and the
      // saved drawing has whatever layer was active at save time, which is
      // usually one of those.
      activateDrawableLayer();
      // First fit. Initial layout may not be settled yet — the
      // ResizeObserver below will refit again as soon as the canvas-wrap
      // gets its real dimensions (and on every subsequent resize while the
      // visitor hasn't started interacting).
      refitNow();
      installResizeObserver();
      installInteractionTracking();
    } catch (err) {
      console.warn("[demo] could not load demos/" + safe + ".dstudio.json:", err);
    }
  }

  function refitNow() {
    if (typeof fitCanvas === "function") fitCanvas();
    fitDrawingToView();
    if (typeof render === "function") render();
  }

  // Whenever the .canvas-wrap changes size — which fires on the first real
  // layout pass AND on every user-driven resize — recompute the fit. We
  // don't recompute once the visitor has touched anything (panned, zoomed,
  // chosen Wall / Measure / Pan), to avoid stomping on their state.
  function installResizeObserver() {
    if (typeof ResizeObserver !== "function") return;
    const wrapEl = document.querySelector(".canvas-wrap");
    if (!wrapEl) return;
    const obs = new ResizeObserver(() => {
      if (userInteracted) {
        // Still resync the canvas pixel buffer so the existing pan/zoom
        // renders crisply at the new size. fitCanvas() doesn't change
        // state.zoom or state.pan — only the backing buffer.
        if (typeof fitCanvas === "function") fitCanvas();
        if (typeof render === "function") render();
        return;
      }
      refitNow();
    });
    obs.observe(wrapEl);
  }

  // Flip the userInteracted flag the first time the visitor does anything
  // that would be worth preserving across a resize: pick a non-select tool,
  // pan / zoom, or click on the canvas. Once tripped, the resize observer
  // stops refitting.
  function installInteractionTracking() {
    const wrapEl = document.querySelector(".canvas-wrap");
    if (!wrapEl) return;
    const trip = () => { userInteracted = true; };

    // Any pointer / wheel on the canvas counts.
    canvas.addEventListener("pointerdown", trip, { capture: true, once: true });
    canvas.addEventListener("wheel",       trip, { capture: true, once: true, passive: true });

    // Picking Wall / Measure / Pan from the demo toolbar also counts. (We
    // don't trip on Select since that's the default and a stray click on it
    // shouldn't lock out resize-fitting.)
    const bar = document.getElementById("demo-toolbar");
    if (bar) {
      bar.addEventListener("click", (e) => {
        const btn = e.target.closest(".demo-tool");
        if (btn && btn.dataset.tool !== "select") trip();
      });
    }
  }

  // Walk the loaded stories and pick the first sublayer that doesn't have a
  // palette spec (palette layers are Windows & Doors / Kitchen / Bathroom /
  // Furniture — drawing tools are blocked on them). Walls is the conventional
  // choice and almost always present.
  function activateDrawableLayer() {
    if (typeof state === "undefined" || !state.stories) return;
    const stories = state.stories;
    let pick = null;
    // Pass 1: prefer a layer literally named "Walls" — that's where wall
    // drawing belongs and matches user expectation.
    for (const story of stories) {
      for (const sub of story.sublayers || []) {
        if (sub.name === "Walls") { pick = sub; break; }
      }
      if (pick) break;
    }
    // Pass 2: any layer without a palette spec.
    if (!pick) {
      for (const story of stories) {
        for (const sub of story.sublayers || []) {
          if (typeof paletteSpecForLayer !== "function" || !paletteSpecForLayer(sub)) {
            pick = sub; break;
          }
        }
        if (pick) break;
      }
    }
    if (pick) {
      state.activeSublayerId = pick.id;
      if (typeof renderLayerTree === "function") renderLayerTree();
      if (typeof updatePaletteVisibility === "function") updatePaletteVisibility();
      // Recompute disabled state on the (hidden) original tool buttons so
      // the LAYER_DRAW_TOOLS guard in setTool reads the right answer.
      if (typeof updateToolButtonsForLayer === "function") updateToolButtonsForLayer();
    }
  }

  // Compute the bounding box of every visible shape and zoom-to-fit with a
  // little padding. Cleaner than centerView() for embedded use because the
  // iframe size varies and the saved zoom is likely wrong for it.
  function fitDrawingToView() {
    if (typeof state === "undefined" || !state.stories) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const story of state.stories) {
      if (!story.visible) continue;
      for (const sub of story.sublayers || []) {
        if (!sub.visible) continue;
        for (const sh of sub.shapes || []) {
          // Use shapeBBox from selection.js when available — it knows every
          // shape type's true extent. Otherwise fall back to obvious props.
          let bb = null;
          if (typeof shapeBBox === "function") {
            try { bb = shapeBBox(sh); } catch (_) { bb = null; }
          }
          // bbox shape: { x1, y1, x2, y2 } — see shapes.js SHAPES[type].bbox.
          if (bb && isFinite(bb.x1) && isFinite(bb.y1) && isFinite(bb.x2) && isFinite(bb.y2)) {
            if (bb.x1 < minX) minX = bb.x1;
            if (bb.y1 < minY) minY = bb.y1;
            if (bb.x2 > maxX) maxX = bb.x2;
            if (bb.y2 > maxY) maxY = bb.y2;
          }
        }
      }
    }
    if (!isFinite(minX) || !isFinite(maxX)) {
      if (typeof centerView === "function") centerView();
      return;
    }
    // Use the same view size the renderer uses (canvas-wrap rect in CSS px) —
    // matches centerView()'s assumptions and avoids dpr / canvas-buffer drift.
    const view = (typeof viewSize === "function") ? viewSize() : { w: canvas.clientWidth, h: canvas.clientHeight };
    const cw = view.w, ch = view.h;
    if (cw <= 0 || ch <= 0) return;
    const dw = maxX - minX, dh = maxY - minY;
    if (dw <= 0 || dh <= 0) {
      if (typeof centerView === "function") centerView();
      return;
    }
    // Pad ~12% so the drawing isn't kissing the iframe edges.
    const pad = 0.12;
    const zx = cw / (dw * PX_PER_FOOT * (1 + pad));
    const zy = ch / (dh * PX_PER_FOOT * (1 + pad));
    const zoom = Math.min(zx, zy);
    state.zoom = zoom;
    // Center the drawing in the canvas. The canvas-view conversion is
    // screen = world * (zoom * PX_PER_FOOT) + pan. Solve for pan so the
    // bbox center lands at the canvas center.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    state.pan.x = cw / 2 - cx * zoom * PX_PER_FOOT;
    state.pan.y = ch / 2 - cy * zoom * PX_PER_FOOT;
    if (typeof zoomReadout !== "undefined" && zoomReadout) {
      zoomReadout.textContent = Math.round(zoom * 100) + "%";
    }
  }

  // init() in main.js runs synchronously before this script's body executes
  // (load order in index.html: main.js, then demo-mode.js). Everything is
  // already bound; we can manipulate the DOM and state directly.
  injectDemoToolbar();
  injectDemoChrome();
  patchRenderForToolbarSync();
  setTool("select");
  loadDemoFile();
})();
