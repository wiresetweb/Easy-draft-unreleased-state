'use strict';

// ==============================================================================
// Palette panel — doors / windows / kitchen catalog UI + placement.
// ==============================================================================

// SVG previews for palette items.
function paletteIconSvg(item) {
  const stroke = `stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  if (item.subtype === "sliding") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M2 8 H 46 M 2 18 H 46" stroke-width="0.9"/>
      <path d="M5 11 H 25" stroke-width="2"/>
      <path d="M23 15 H 43" stroke-width="2"/>
    </svg>`;
  }
  if (item.subtype === "double") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M2 22 H 8" stroke-width="2"/>
      <path d="M40 22 H 46" stroke-width="2"/>
      <path d="M8 22 V 8" stroke-width="1.5"/>
      <path d="M40 22 V 8" stroke-width="1.5"/>
      <path d="M24 22 A 16 16 0 0 0 8 8" stroke-width="0.9" stroke-dasharray="2 2"/>
      <path d="M24 22 A 16 16 0 0 1 40 8" stroke-width="0.9" stroke-dasharray="2 2"/>
    </svg>`;
  }
  if (item.subtype === "pocket") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M2 22 H 6" stroke-width="2"/>
      <path d="M42 22 H 46" stroke-width="2"/>
      <path d="M6 22 V 14" stroke-width="1.5"/>
      <path d="M42 22 V 14" stroke-width="1.5"/>
      <path d="M9 18 H 42" stroke-width="2"/>
      <path d="M13 14 L 9 18 L 13 22" stroke-width="1.2"/>
    </svg>`;
  }
  if (item.subtype === "garage") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M2 22 H 5" stroke-width="2"/>
      <path d="M43 22 H 46" stroke-width="2"/>
      <path d="M5 22 V 14" stroke-width="1.5"/>
      <path d="M43 22 V 14" stroke-width="1.5"/>
      <path d="M5 18 H 43" stroke-width="1.2"/>
      <path d="M14 16 V 20 M 24 16 V 20 M 34 16 V 20" stroke-width="0.7"/>
    </svg>`;
  }
  if (item.kind === "range" || item.kind === "cooktop") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" stroke-width="1.5"/>
      <circle cx="16" cy="10" r="3" stroke-width="1"/>
      <circle cx="32" cy="10" r="3" stroke-width="1"/>
      <circle cx="16" cy="18" r="2" stroke-width="1"/>
      <circle cx="32" cy="18" r="2" stroke-width="1"/>
    </svg>`;
  }
  if (item.kind === "oven") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" stroke-width="1.5"/>
      <line x1="10" y1="8" x2="38" y2="8" stroke-width="1"/>
      <rect x="14" y="11" width="20" height="9" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "fridge") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" stroke-width="1.5"/>
      <line x1="6" y1="10" x2="42" y2="10" stroke-width="1"/>
      <circle cx="38" cy="7" r="0.8" fill="currentColor"/>
      <circle cx="38" cy="17" r="0.8" fill="currentColor"/>
    </svg>`;
  }
  if (item.kind === "dishwasher") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" stroke-width="1.5"/>
      <rect x="10" y="7" width="28" height="12" stroke-width="0.9"/>
      <line x1="14" y1="13" x2="34" y2="13" stroke-width="0.7" stroke-dasharray="2 1"/>
    </svg>`;
  }
  if (item.kind === "sink") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" stroke-width="1.5"/>
      <rect x="11" y="7" width="26" height="12" stroke-width="1"/>
      <circle cx="24" cy="13" r="1.5" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "sink-double") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="4" y="3" width="40" height="20" stroke-width="1.5"/>
      <rect x="8" y="7" width="15" height="12" stroke-width="1"/>
      <rect x="25" y="7" width="15" height="12" stroke-width="1"/>
    </svg>`;
  }
  if (item.kind === "microwave") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="6" width="36" height="14" stroke-width="1.5"/>
      <rect x="9" y="9" width="24" height="8" stroke-width="0.9"/>
      <line x1="36" y1="9" x2="36" y2="17" stroke-width="0.7"/>
    </svg>`;
  }
  if (item.kind === "cabinet") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" stroke-width="1.5"/>
      <line x1="6" y1="3" x2="42" y2="23" stroke-width="0.8"/>
      <line x1="42" y1="3" x2="6" y2="23" stroke-width="0.8"/>
    </svg>`;
  }
  if (item.kind === "island") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="6" width="42" height="14" stroke-width="1.8"/>
      <line x1="3" y1="13" x2="45" y2="13" stroke-width="0.7" stroke-dasharray="2 2"/>
    </svg>`;
  }
  if (item.kind === "armchair") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" rx="3" stroke-width="1.5"/>
      <line x1="6" y1="9" x2="42" y2="9" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "dining-chair") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="14" y="4" width="20" height="18" rx="2" stroke-width="1.5"/>
      <line x1="14" y1="9" x2="34" y2="9" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "stool") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <circle cx="24" cy="13" r="9" stroke-width="1.5"/>
    </svg>`;
  }
  if (item.kind === "loveseat" || item.kind === "sofa") {
    const cushions = item.kind === "loveseat" ? 2 : 3;
    let seams = "";
    for (let i = 1; i < cushions; i++) {
      const x = 9 + (30 * i) / cushions;
      seams += `<line x1="${x}" y1="9" x2="${x}" y2="23" stroke-width="0.9"/>`;
    }
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M3 22 V 5 H 9 V 9 H 39 V 5 H 45 V 22 Z" stroke-width="1.5" fill="none"/>
      ${seams}
    </svg>`;
  }
  if (item.kind === "sectional") {
    // Same L geometry as drawSectionalInterior: sofa across the top, chaise
    // (right ⅓) extending forward to the bottom-right.
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M 3 4 H 45 V 22 H 31 V 13 H 3 Z" stroke-width="1.5"/>
      <line x1="12" y1="4" x2="12" y2="13" stroke-width="0.7"/>
      <line x1="22" y1="4" x2="22" y2="13" stroke-width="0.7"/>
      <line x1="31" y1="13" x2="45" y2="13" stroke-width="0.7"/>
    </svg>`;
  }
  if (item.kind === "media-console") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="7" width="42" height="12" stroke-width="1.5"/>
      <line x1="15" y1="7" x2="15" y2="19" stroke-width="0.9"/>
      <line x1="33" y1="7" x2="33" y2="19" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "tv-stand") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="11" width="36" height="4" stroke-width="1.5"/>
      <line x1="9" y1="13" x2="39" y2="13" stroke-width="0.6"/>
    </svg>`;
  }
  if (item.kind === "tv-wall") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <line x1="3" y1="11" x2="45" y2="11" stroke-width="2.4"/>
      <rect x="6" y="13" width="36" height="2" stroke-width="1"/>
    </svg>`;
  }
  if (item.kind === "wardrobe") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" stroke-width="1.5"/>
      <line x1="24" y1="3" x2="24" y2="23" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "dresser") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="6" width="42" height="14" stroke-width="1.5"/>
      <line x1="17" y1="6" x2="17" y2="20" stroke-width="0.9"/>
      <line x1="31" y1="6" x2="31" y2="20" stroke-width="0.9"/>
      <line x1="3" y1="13" x2="45" y2="13" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "floor-lamp") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <circle cx="24" cy="13" r="9" stroke-width="1.5"/>
      <circle cx="24" cy="13" r="3" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "toilet" || item.kind === "toilet-round") {
    // Tank rectangle on the back (left in the 48×26 viewbox), bowl ellipse
    // extending forward, with a seat ring inset and a U opening at the front.
    const isRound = item.kind === "toilet-round";
    const seatRx = isRound ? 9 : 11;
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="6" width="11" height="14" rx="1.2" stroke-width="1.4"/>
      <ellipse cx="29" cy="13" rx="${seatRx + 2}" ry="9" stroke-width="1.4"/>
      <path d="M 38 13 A ${seatRx} 7.5 0 1 1 38 12.99" stroke-width="0.8"/>
    </svg>`;
  }
  if (item.kind === "toilet-wall") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <ellipse cx="24" cy="13" rx="13" ry="9" stroke-width="1.4"/>
      <ellipse cx="24" cy="13" rx="10.5" ry="7.2" stroke-width="0.8"/>
    </svg>`;
  }
  if (item.kind === "bidet") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <ellipse cx="24" cy="13" rx="11" ry="9" stroke-width="1.4"/>
      <ellipse cx="24" cy="13.4" rx="8" ry="7" stroke-width="0.8"/>
      <circle cx="24" cy="6" r="1.2" stroke-width="0.8"/>
    </svg>`;
  }
  if (item.kind === "urinal") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M 14 5 L 34 5 A 10 16 0 0 1 14 5 Z" stroke-width="1.4"/>
      <circle cx="24" cy="14" r="1.6" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "lav-pedestal") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <ellipse cx="24" cy="14" rx="13" ry="9" stroke-width="1.4"/>
      <ellipse cx="24" cy="14.4" rx="9" ry="6" stroke-width="0.9"/>
      <line x1="24" y1="3" x2="24" y2="8" stroke-width="0.9"/>
      <circle cx="24" cy="3.2" r="1.2" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "vanity") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="3" width="42" height="20" stroke-width="1.5"/>
      <rect x="16" y="7" width="16" height="13" rx="1.5" stroke-width="0.9"/>
      <circle cx="24" cy="13.5" r="1.3" stroke-width="0.7"/>
      <line x1="24" y1="4" x2="24" y2="7" stroke-width="0.7"/>
    </svg>`;
  }
  if (item.kind === "vanity-double") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="3" width="42" height="20" stroke-width="1.5"/>
      <line x1="24" y1="3" x2="24" y2="23" stroke-width="0.6"/>
      <rect x="6" y="7" width="14" height="13" rx="1.4" stroke-width="0.9"/>
      <rect x="28" y="7" width="14" height="13" rx="1.4" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "tub-alcove") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="3" width="42" height="20" stroke-width="1.5"/>
      <rect x="7" y="6" width="36" height="14" rx="3" stroke-width="1"/>
      <circle cx="11" cy="13" r="1.3" stroke-width="0.8"/>
    </svg>`;
  }
  if (item.kind === "tub-shower") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="3" width="42" height="20" stroke-width="1.5"/>
      <rect x="7" y="6" width="36" height="14" rx="3" stroke-width="1"/>
      <circle cx="11" cy="13" r="1.3" stroke-width="0.8"/>
      <circle cx="7" cy="6" r="1.6" stroke-width="0.9"/>
      <line x1="3" y1="22" x2="45" y2="22" stroke-width="0.7" stroke-dasharray="2 1.5"/>
    </svg>`;
  }
  if (item.kind === "tub-soaker") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="3" width="42" height="20" stroke-width="1.5"/>
      <rect x="7" y="6" width="34" height="14" rx="6" stroke-width="1"/>
      <circle cx="24" cy="13" r="1.3" stroke-width="0.8"/>
    </svg>`;
  }
  if (item.kind === "tub-freestand") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <ellipse cx="24" cy="13" rx="20" ry="9" stroke-width="1.6"/>
      <ellipse cx="24" cy="13" rx="16.5" ry="7" stroke-width="0.9"/>
      <circle cx="24" cy="13" r="1.3" stroke-width="0.8"/>
    </svg>`;
  }
  if (item.kind === "tub-corner") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M 4 4 L 44 4 A 40 22 0 0 1 4 24 Z" stroke-width="1.6"/>
      <path d="M 8 7 L 38 7 A 30 16 0 0 1 8 21 Z" stroke-width="0.9"/>
      <circle cx="14" cy="10" r="1.2" stroke-width="0.8"/>
    </svg>`;
  }
  if (item.kind === "shower") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="3" width="42" height="20" stroke-width="1.5"/>
      <line x1="3" y1="3" x2="45" y2="23" stroke-width="0.5"/>
      <line x1="45" y1="3" x2="3" y2="23" stroke-width="0.5"/>
      <circle cx="24" cy="13" r="1.6" stroke-width="0.9"/>
      <circle cx="38" cy="6" r="1.6" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "shower-corner") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <path d="M 4 4 L 44 4 A 40 22 0 0 1 4 24 Z" stroke-width="1.6"/>
      <path d="M 4 4 A 36 20 0 0 1 4 24" stroke-width="0.7" stroke-dasharray="2 1.5"/>
      <circle cx="14" cy="11" r="1.4" stroke-width="0.9"/>
    </svg>`;
  }
  if (item.kind === "washer" || item.kind === "dryer") {
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="6" y="3" width="36" height="20" stroke-width="1.5"/>
      <line x1="6" y1="8" x2="42" y2="8" stroke-width="0.8"/>
      <circle cx="24" cy="15" r="6" stroke-width="1"/>
      <circle cx="24" cy="15" r="4" stroke-width="0.7"/>
    </svg>`;
  }
  if (item.kind === "custom") {
    // Render the actual primitives (scaled to fit) so the thumbnail matches
    // the dropped shape — that's what "custom" means.
    return customFurnitureIconSvg(item);
  }
  if (!item.subtype) {
    // window
    return `<svg viewBox="0 0 48 26" ${stroke}>
      <rect x="3" y="9" width="42" height="10" stroke-width="1.5"/>
      <line x1="3" y1="14" x2="45" y2="14" stroke-width="0.8"/>
    </svg>`;
  }
  // swing
  return `<svg viewBox="0 0 48 26" ${stroke}>
    <path d="M2 22 H 10" stroke-width="2"/>
    <path d="M38 22 H 46" stroke-width="2"/>
    <path d="M10 22 V 4" stroke-width="1.5"/>
    <path d="M38 22 A 28 28 0 0 0 10 4" stroke-width="0.9" stroke-dasharray="2 2"/>
  </svg>`;
}

// Layer name -> { title, sections } where sections is an array of palette section keys.
const PALETTE_LAYERS = {
  [WINDOW_DOOR_LAYER_NAME]: { title: "Windows & Doors", sections: ["doors", "windows"] },
  [KITCHEN_LAYER_NAME]: {
    title: "Kitchen",
    sections: ["kitchen"],
    tools: [
      {
        id: "cabinet-builder",
        label: "Cabinet Builder Tool",
        icon: '<svg viewBox="0 0 20 14" width="20" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="16" height="10" rx="1"/><line x1="2" y1="6" x2="18" y2="6"/><line x1="7" y1="6" x2="7" y2="12"/><line x1="13" y1="6" x2="13" y2="12"/></svg>',
      },
    ],
  },
  [FURNITURE_LAYER_NAME]: {
    title: "Furniture",
    sections: ["furniture"],
    tools: [
      {
        id: "furniture-builder",
        label: "Furniture Builder",
        icon: '<svg viewBox="0 0 20 14" width="20" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="9" height="10" rx="1"/><circle cx="15" cy="6" r="2.4"/><line x1="13" y1="11" x2="18" y2="11"/></svg>',
      },
    ],
  },
  [BATHROOM_LAYER_NAME]: { title: "Bathroom", sections: ["bathroom"] },
};
const PALETTE_SECTION_LABELS = {
  doors:     "Doors",
  windows:   "Windows",
  kitchen:   "Appliances",
  furniture: "Furniture",
  bathroom:  "Fixtures",
};

// Render a custom piece's primitives into a 48×26 SVG that fits the palette
// thumbnail. The primitives are stored centered at (0, 0) in feet — we just
// scale to fit the inner box and translate to the SVG center.
function customFurnitureIconSvg(item) {
  const prims = Array.isArray(item.primitives) ? item.primitives : [];
  if (!prims.length) {
    return `<svg viewBox="0 0 48 26" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <rect x="6" y="3" width="36" height="20" stroke-width="1.2" stroke-dasharray="3 2"/>
    </svg>`;
  }
  const innerW = 40, innerH = 22;
  const w = item.width || 1, d = item.depth || 1;
  const scale = Math.min(innerW / w, innerH / d);
  const cx = 24, cy = 13;
  let body = "";
  for (const p of prims) {
    if (p.type === "line") {
      body += `<line x1="${p.x1*scale+cx}" y1="${p.y1*scale+cy}" x2="${p.x2*scale+cx}" y2="${p.y2*scale+cy}" stroke-width="1.1"/>`;
    } else if (p.type === "rect") {
      const x = p.x * scale + cx;
      const y = p.y * scale + cy;
      const rw = p.w * scale;
      const rh = p.h * scale;
      const rr = Math.max(0, Math.min(rw / 2, rh / 2, (p.r || 0) * scale));
      body += `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="${rr}" stroke-width="1.1"/>`;
    } else if (p.type === "circle") {
      body += `<circle cx="${p.cx*scale+cx}" cy="${p.cy*scale+cy}" r="${p.r*scale}" stroke-width="1.1"/>`;
    }
  }
  return `<svg viewBox="0 0 48 26" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function paletteSpecForLayer(sub) {
  if (!sub) return null;
  return PALETTE_LAYERS[sub.name] || null;
}

function updatePaletteVisibility() {
  const sub = activeSublayer();
  const spec = paletteSpecForLayer(sub);
  const showPalette = !!spec;
  palettePanel.classList.toggle("hidden", !showPalette);
  // Free up screen real estate for the palette by collapsing the layers panel
  // to its header when a layer with a drag-and-drop palette is active.
  layersPanel.classList.toggle("minimized", showPalette);
  if (spec) {
    const titleEl = palettePanel.querySelector(".palette-title");
    if (titleEl) titleEl.textContent = spec.title;
    renderPalette();
    positionPaletteUnderLayers();
  }
  // Drawing tools are inert on palette layers — reflect that in the toolbar
  // and bounce the active tool to select if it's no longer allowed.
  updateToolButtonsForLayer();
  if (LAYER_DRAW_TOOLS.has(state.tool) && isLayerDrawingBlocked()) {
    setTool("select");
  }
}

// Anchor the palette panel to the bottom edge of the layers panel so it never
// ends up clipping the layers, regardless of viewport size, drag position, or
// whether the layers panel is currently minimized.
function positionPaletteUnderLayers() {
  const lLeft = layersPanel.offsetLeft;
  const lTop = layersPanel.offsetTop;
  const lWidth = layersPanel.offsetWidth;
  const lHeight = layersPanel.offsetHeight;
  const gap = 8;
  palettePanel.style.left = lLeft + "px";
  palettePanel.style.right = "auto";
  palettePanel.style.top = (lTop + lHeight + gap) + "px";
  palettePanel.style.width = lWidth + "px";
}

// Cabinet modal is normally a floating element under <main>. While the cabinet
// builder is active, we move it into the palette body so the user has the full
// canvas free for clicking nodes. We remember its original parent so we can
// put it back when the builder is done.
let cabinetModalHome = null;

function detachCabinetModalFromPalette() {
  if (!cabinetModalHome) cabinetModalHome = cabinetModal.parentElement;
  if (cabinetModal.parentElement === paletteBody) {
    cabinetModalHome.appendChild(cabinetModal);
  }
  cabinetModal.classList.remove("in-palette");
  cabinetModal.classList.add("hidden");
}

function attachCabinetModalToPalette() {
  if (!cabinetModalHome) cabinetModalHome = cabinetModal.parentElement;
  cabinetModal.classList.add("in-palette");
  cabinetModal.classList.remove("hidden");
  if (paletteBody.firstChild) paletteBody.insertBefore(cabinetModal, paletteBody.firstChild);
  else paletteBody.appendChild(cabinetModal);
}

function renderPalette() {
  // Detach the cabinet modal first so innerHTML clearing doesn't drop the
  // element (it has its own listeners we want to preserve).
  if (cabinetModal && cabinetModal.parentElement === paletteBody) {
    detachCabinetModalFromPalette();
  }

  paletteBody.innerHTML = "";
  const spec = paletteSpecForLayer(activeSublayer());
  if (!spec) return;

  // Tool buttons that live above the dropdown sections. While a tool's UI is
  // active (e.g. cabinet builder), we replace its launcher button with the
  // tool's own controls inline in the palette. When the tool finishes, the
  // launcher button comes back automatically.
  if (spec.tools) {
    for (const tool of spec.tools) {
      if (tool.id === "cabinet-builder" && state.cabinetBuilder) {
        attachCabinetModalToPalette();
        continue;
      }
      const btn = document.createElement("button");
      btn.className = "palette-tool-btn";
      btn.dataset.paletteTool = tool.id;
      btn.innerHTML = `${tool.icon || ""}<span>${tool.label}</span>`;
      paletteBody.appendChild(btn);
    }
  }

  for (const sectionKey of spec.sections) {
    const items = PALETTE_ITEMS[sectionKey];
    if (!items) continue;
    const section = document.createElement("div");
    section.className = "palette-section" + (state.paletteExpanded[sectionKey] ? "" : " collapsed");
    section.dataset.section = sectionKey;

    const header = document.createElement("div");
    header.className = "palette-section-header";
    header.dataset.action = "toggle";
    header.innerHTML = `${caretSvg()}<span>${PALETTE_SECTION_LABELS[sectionKey] || sectionKey}</span>`;
    section.appendChild(header);

    const content = document.createElement("div");
    content.className = "palette-section-content";

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemEl = document.createElement("div");
      itemEl.className = "palette-item";
      itemEl.dataset.section = sectionKey;
      itemEl.dataset.index = String(i);
      const icon = document.createElement("div");
      icon.className = "palette-item-icon";
      icon.innerHTML = paletteIconSvg({
        subtype: sectionKey === "windows" ? null : item.subtype,
        kind: item.kind,
      });
      itemEl.appendChild(icon);
      const name = document.createElement("span");
      name.className = "palette-item-name";
      name.textContent = paletteItemDisplayName(item);
      itemEl.appendChild(name);
      content.appendChild(itemEl);
    }

    section.appendChild(content);
    paletteBody.appendChild(section);
  }
}

function clampPanel() {
  const wrapRect = wrap.getBoundingClientRect();
  for (const panel of [palettePanel, layersPanel]) {
    if (!panel) continue;
    const panelW = panel.offsetWidth;
    const panelH = panel.offsetHeight;
    const left = panel.offsetLeft;
    const top = panel.offsetTop;
    if (left + panelW > wrapRect.width) {
      panel.style.left = Math.max(0, wrapRect.width - panelW) + "px";
      panel.style.right = "auto";
    }
    if (top + panelH > wrapRect.height) {
      panel.style.top = Math.max(0, wrapRect.height - panelH) + "px";
    }
  }
}

function bindFloatingPanelChrome(panel, header, minBtn, resizer) {
  header.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const startX = e.clientX, startY = e.clientY;
    const wrapRect = wrap.getBoundingClientRect();
    const origLeft = panel.offsetLeft;
    const origTop = panel.offsetTop;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newLeft = Math.max(0, Math.min(origLeft + dx, wrapRect.width - panel.offsetWidth));
      const newTop = Math.max(0, Math.min(origTop + dy, wrapRect.height - panel.offsetHeight));
      panel.style.left = newLeft + "px";
      panel.style.top = newTop + "px";
      panel.style.right = "auto";
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    e.preventDefault();
  });

  if (minBtn) {
    minBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("minimized");
    });
  }

  if (resizer) {
    resizer.addEventListener("pointerdown", (e) => {
      const startX = e.clientX, startY = e.clientY;
      const origW = panel.offsetWidth;
      const origH = panel.offsetHeight;
      const wrapRect = wrap.getBoundingClientRect();
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const newW = Math.max(220, Math.min(origW + dx, wrapRect.width - panel.offsetLeft));
        const newH = Math.max(120, Math.min(origH + dy, wrapRect.height - panel.offsetTop));
        panel.style.width = newW + "px";
        panel.style.height = newH + "px";
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      e.preventDefault();
      e.stopPropagation();
    });
  }
}

function bindLayersPanel() {
  bindFloatingPanelChrome(layersPanel, layersHeader, layersMin, layersResize);

  // Whenever the layers panel changes size or position (minimize toggle, manual
  // resize, or drag), keep the palette tucked underneath so the layers panel
  // can never end up obscured by it.
  const reposition = () => {
    if (palettePanel.classList.contains("hidden")) return;
    positionPaletteUnderLayers();
  };
  layersMin.addEventListener("click", () => {
    requestAnimationFrame(reposition);
  });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(reposition).observe(layersPanel);
  }
  new MutationObserver(reposition).observe(layersPanel, {
    attributes: true,
    attributeFilter: ["style"],
  });
}

function bindPalettePanel() {
  bindFloatingPanelChrome(palettePanel, paletteHeader, paletteMin, paletteResize);

  // Section toggles + item drag-place
  paletteBody.addEventListener("click", (e) => {
    const toolBtn = e.target.closest(".palette-tool-btn");
    if (toolBtn) {
      const id = toolBtn.dataset.paletteTool;
      if (id === "cabinet-builder") startCabinetBuilder();
      else if (id === "furniture-builder") openFurnitureBuilder();
      return;
    }
    const sectionHeader = e.target.closest(".palette-section-header");
    if (sectionHeader) {
      const section = sectionHeader.parentElement;
      const key = section.dataset.section;
      state.paletteExpanded[key] = !state.paletteExpanded[key];
      renderPalette();
    }
  });

  paletteBody.addEventListener("pointerdown", (e) => {
    const item = e.target.closest(".palette-item");
    if (!item) return;
    const sectionKey = item.dataset.section;
    const index = parseInt(item.dataset.index, 10);
    const def = PALETTE_ITEMS[sectionKey][index];
    if (!def) return;

    state.placing = { def, sectionKey };
    wrap.classList.add("placing");
    e.preventDefault();

    const onMove = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      state.cursorScreen = { x: sx, y: sy };
      state.cursorWorld = screenToWorld(sx, sy);
      render();
    };
    const onUp = (ev) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const overCanvas = sx >= 0 && sx <= rect.width && sy >= 0 && sy <= rect.height;
      if (overCanvas) placeItem(def, sectionKey, screenToWorld(sx, sy));
      state.placing = null;
      wrap.classList.remove("placing");
      render();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

function placeItem(def, sectionKey, worldPos) {
  const layer = activeSublayer();
  if (!layer) return;

  if (sectionKey === "kitchen" || sectionKey === "furniture" || sectionKey === "bathroom") {
    let x, y, angle;
    // Free-standing pieces (islands, free-standing custom furniture, free-
    // standing tubs) skip the wall-back snap so they don't drag against
    // random walls.
    const skipWallSnap =
      (sectionKey === "kitchen" && def.kind === "island") ||
      def.kind === "tub-freestand" ||
      def.kind === "tub-soaker" ||
      def.kind === "custom";
    const wallBack = skipWallSnap
      ? null
      : detectWallBackedPosition(worldPos, def.width, def.depth, applianceWallGap(def.kind));
    if (wallBack) {
      x = wallBack.x; y = wallBack.y; angle = wallBack.angle;
    } else {
      const pos = snapWorldHalf(worldPos);
      x = pos.x - def.width / 2;
      y = pos.y - def.depth / 2;
      angle = 0;
    }
    const shape = {
      id: makeId("X"),
      type: "appliance",
      x, y,
      width: def.width,
      depth: def.depth,
      angle,
      kind: def.kind,
      label: def.name,
    };
    if (def.kind === "custom" && Array.isArray(def.primitives)) {
      // Snapshot the primitives onto the shape — placed pieces stay valid even
      // if the source library entry is renamed or removed later.
      shape.primitives = def.primitives.map((p) => ({ ...p }));
      shape.customId = def.customId;
    }
    pushHistory();
    layer.shapes.push(shape);
    state.selection.clear();
    state.selection.add(shape.id);
    return;
  }

  // Windows straddle the wall (anchor is offset by -depth/2 perpendicular so
  // the wall centerline runs through the middle of the window). Doors anchor
  // on the centerline as before — passing 0 keeps the legacy behavior.
  const depthForAlign = sectionKey === "windows" ? DEFAULT_WINDOW_DEPTH_FT : 0;
  const aligned = detectAlignedPosition(worldPos, def.width, depthForAlign);
  const pos = aligned || snapWorldHalf(worldPos);
  const angle = aligned ? aligned.angle : 0;
  let shape;
  if (sectionKey === "windows") {
    shape = {
      id: makeId("X"),
      type: "window",
      x: pos.x, y: pos.y,
      width: def.width,
      depth: DEFAULT_WINDOW_DEPTH_FT,
      angle,
      kind: def.name,
    };
  } else {
    shape = {
      id: makeId("X"),
      type: "door",
      x: pos.x, y: pos.y,
      width: def.width,
      angle,
      swing: 1,
      subtype: def.subtype || "swing",
      kind: def.name,
    };
  }

  // Detect walls this opening would land on (before pushing history)
  const { wallsLayer, walls } = findWallsForOpening(shape);
  let shouldCut = false;
  if (walls.length > 0) {
    shouldCut = confirm(`Cut the wall to fit ${paletteItemDisplayName(def)}?`);
  }

  pushHistory();
  layer.shapes.push(shape);
  state.selection.clear();
  state.selection.add(shape.id);

  if (shouldCut && wallsLayer) {
    for (const wall of walls) cutWallForOpening(wallsLayer, wall, shape);
  }
}
