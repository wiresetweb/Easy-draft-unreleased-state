'use strict';

// ==============================================================================
// Events — tool selection, pointer / keyboard handling.
// ==============================================================================

// ---------- Tools ----------
function constrainLine(a, b, shift) {
  if (!shift) return b;
  const dx = b.x - a.x, dy = b.y - a.y;
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  const len = Math.hypot(dx, dy);
  return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
}

// Tools that draw shapes onto the active sublayer. They're disabled when the
// active layer has its own palette (Doors & Windows, Kitchen, …) so the user
// is forced to switch layers — palette layers expect items from the palette,
// not freehand strokes. Add new drawing tools here as they're built.
const LAYER_DRAW_TOOLS = new Set(["line", "stairs", "box"]);

function isLayerDrawingBlocked() {
  return !!paletteSpecForLayer(activeSublayer());
}

function updateToolButtonsForLayer() {
  const blocked = isLayerDrawingBlocked();
  for (const btn of toolListEl.querySelectorAll(".tool")) {
    const t = btn.dataset.tool;
    btn.classList.toggle("disabled", LAYER_DRAW_TOOLS.has(t) && blocked);
  }
}

function setTool(tool) {
  // Refuse drawing tools on palette layers — silently fall back to select
  // rather than putting the canvas in a broken "drawing on Kitchen" state.
  if (LAYER_DRAW_TOOLS.has(tool) && isLayerDrawingBlocked()) {
    tool = "select";
  }
  state.tool = tool;
  state.pending = null;
  if (tool !== "select") {
    state.marquee = null;
    state.selectionMode = null;
    state.selectionData = null;
    state.curveDrag = null;
    // The "wrong layer?" hint is select-tool specific. Reset its counter
    // and dismiss the modal so a stale prompt doesn't follow the user into
    // a drawing tool.
    resetCrossLayerMisses();
    hideLayerHintModal();
  }
  for (const btn of toolListEl.querySelectorAll(".tool")) {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  }
  wrap.classList.remove("tool-line", "tool-pan", "tool-select", "tool-measure", "tool-text", "tool-stairs", "tool-box", "tool-cabinet");
  wrap.classList.add("tool-" + tool);
  if (tool !== "stairs") {
    state.stairsDirection = null;
    hideStairsModal();
  }
  if (tool !== "cabinet" && state.cabinetBuilder) {
    // User picked a different tool mid-build — auto-commit anything substantial
    // so they don't lose work; otherwise just discard the lone start node.
    if (state.cabinetBuilder.points.length >= 2) commitCabinet(state.cabinetBuilder);
    state.cabinetBuilder = null;
    detachCabinetModalFromPalette();
    renderPalette();
  }
  canvas.style.cursor = "";
  statusTool.textContent = tool.charAt(0).toUpperCase() + tool.slice(1);
  render();
}

// ---------- Events ----------
function bindEvents() {
  window.addEventListener("resize", () => { fitCanvas(); clampPanel(); render(); });

  toolListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tool");
    if (!btn) return;
    setTool(btn.dataset.tool);
  });

  zoomInBtn.addEventListener("click", () => setZoom(state.zoom * 1.25));
  zoomOutBtn.addEventListener("click", () => setZoom(state.zoom / 1.25));
  zoomResetBtn.addEventListener("click", () => {
    state.zoom = 1;
    centerView();
    zoomReadout.textContent = "100%";
    render();
  });

  gridSizeInput.addEventListener("input", () => {
    const raw = parseFloat(gridSizeInput.value);
    if (!isFinite(raw)) return;
    // The input is whatever the current display unit is; convert to feet for
    // storage. Floor at ~15 mm so neither unit can drive snap math to zero.
    const ft = state.units === "metric" ? raw * MM_TO_FT : raw;
    if (ft < 0.05) return;
    state.gridSize = ft;
    render();
  });
  snapToggle.addEventListener("change", () => {
    state.snap = snapToggle.checked;
    render();
  });

  gridOpacityInput.addEventListener("input", () => {
    const v = parseFloat(gridOpacityInput.value);
    if (!isFinite(v)) return;
    state.gridOpacity = Math.max(0, Math.min(1, v / 100));
    render();
  });

  layerTreeEl.addEventListener("click", async (e) => {
    const actionBtn = e.target.closest("[data-action]");
    const subRow = e.target.closest(".sub-row");
    const storyEl = e.target.closest(".story");
    const story = storyEl ? state.stories.find((s) => s.id === storyEl.dataset.storyId) : null;

    if (actionBtn) {
      e.stopPropagation();
      if (!story) return;
      const action = actionBtn.dataset.action;
      if (action === "expand") {
        story.expanded = !story.expanded;
        renderLayerTree();
      } else if (action === "vis-story") {
        // Visibility is a view setting, not a content edit — it round-trips
        // through save/load but doesn't belong on the undo stack. Toggling
        // a layer back on shouldn't require an undo step the user has to
        // skip past to get to their last shape edit.
        story.visible = !story.visible;
        renderLayerTree();
        renderSheetLayerTree();
        render();
      } else if (action === "add-sub") {
        const name = await appPrompt("Name for new sub-layer:", "New Layer", {
          title: "New sub-layer",
          confirmLabel: "Add",
        });
        if (name && name.trim()) {
          pushHistory();
          addSublayer(story.id, name.trim());
          renderLayerTree();
          renderSheetLayerTree();
          render();
        }
      } else if (action === "vis-sub" && subRow) {
        const sub = story.sublayers.find((l) => l.id === subRow.dataset.subId);
        if (sub) {
          // See vis-story above: visibility is a view setting, not undoable.
          sub.visible = !sub.visible;
          renderLayerTree();
          renderSheetLayerTree();
          render();
        }
      } else if (action === "color-sub" && subRow) {
        const sub = story.sublayers.find((l) => l.id === subRow.dataset.subId);
        if (sub) toggleColorPopup(actionBtn, sub);
      } else if (action === "delete-story") {
        const shapeCount = story.sublayers.reduce((n, l) => n + l.shapes.length, 0);
        const detail = shapeCount === 0
          ? "It contains no objects."
          : `This will also remove ${shapeCount} object${shapeCount === 1 ? "" : "s"} on its layers.`;
        const ok = await appConfirm(`${detail}\n\nYou can undo with Ctrl+Z.`, {
          title: `Delete "${story.name}"?`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        pushHistory();
        if (deleteStory(story.id)) {
          renderLayerTree();
          renderSheetLayerTree();
          render();
        }
      } else if (action === "delete-sub" && subRow) {
        const sub = story.sublayers.find((l) => l.id === subRow.dataset.subId);
        if (!sub) return;
        const detail = sub.shapes.length === 0
          ? "It's empty."
          : `This will also remove ${sub.shapes.length} object${sub.shapes.length === 1 ? "" : "s"} on it.`;
        const ok = await appConfirm(`${detail}\n\nYou can undo with Ctrl+Z.`, {
          title: `Delete "${sub.name}" from ${story.name}?`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        pushHistory();
        if (deleteSublayer(story.id, sub.id)) {
          renderLayerTree();
          renderSheetLayerTree();
          render();
        }
      }
      return;
    }

    if (subRow) {
      // If the cabinet builder is active and the user switches layers, treat
      // it the same as a tool switch: commit substantial work, drop a stub.
      if (state.cabinetBuilder) {
        if (state.cabinetBuilder.points.length >= 2) commitCabinet(state.cabinetBuilder);
        state.cabinetBuilder = null;
        detachCabinetModalFromPalette();
        if (state.tool === "cabinet") setTool("select");
      }
      // Layer-locked selection: any leftover selection from a prior layer
      // would still be transformable via handles even though direct clicks
      // can't grab those shapes. Clear it on switch so the user starts fresh
      // on the new layer.
      if (state.activeSublayerId !== subRow.dataset.subId) {
        state.selection.clear();
        resetCrossLayerMisses();
        hideLayerHintModal();
      }
      state.activeSublayerId = subRow.dataset.subId;
      renderLayerTree();
      render();
    }
  });

  addStoryBtn.addEventListener("click", () => {
    pushHistory();
    addStory();
    renderLayerTree();
    renderSheetLayerTree();
    render();
  });

  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);
  clearBtn.addEventListener("click", async () => {
    const layer = activeSublayer();
    if (!layer || !layer.shapes.length) return;
    const count = layer.shapes.length;
    const noun = count === 1 ? "object" : "objects";
    const ok = await appConfirm(
      `Remove all ${count} ${noun} on this layer? You can undo with Ctrl+Z.`,
      {
        title: `Clear "${layer.name}" layer?`,
        confirmLabel: "Clear",
        danger: true,
      },
    );
    if (!ok) return;
    pushHistory();
    for (const sh of layer.shapes) state.selection.delete(sh.id);
    layer.shapes = [];
    render();
  });

  canvas.addEventListener("wheel", (e) => {
    if (state.viewMode === "plan") { planWheel(e); return; }
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (e.shiftKey) {
      state.pan.x -= e.deltaY;
      render();
    } else {
      const factor = Math.pow(1.0015, -e.deltaY);
      setZoom(state.zoom * factor, { x: sx, y: sy });
    }
  }, { passive: false });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", () => {
    if (state.panning) endPan();
  });

  // Suppress middle-button autoscroll. Browsers fire the autoscroll UI on
  // mousedown for button === 1 — preventDefault on pointerdown isn't enough
  // to stop it on every browser, so we listen here too. The actual pan
  // logic lives in onPointerDown / startPan.
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // Right-click is owned by the app — never show the browser menu over the
  // canvas. Dispatch by current state: in-progress draws cancel, the
  // cabinet builder pops a node, and an idle select tool shows the custom
  // context menu (Cut / Copy / Paste / etc.).
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (state.viewMode === "plan") return;
    if (state.cabinetBuilder) {
      undoLastCabinetPoint();
      return;
    }
    if (state.pending) { state.pending = null; render(); return; }
    if (state.placing) {
      state.placing = null;
      wrap.classList.remove("placing");
      render();
      return;
    }
    if (state.stairsDirection || (stairsModal && !stairsModal.classList.contains("hidden"))) {
      cancelStairs();
      return;
    }
    if (state.tool === "select") {
      showContextMenu(e);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) return;
    // The furniture builder runs in a modal with its own keyboard logic — let
    // it own all shortcuts while it's up.
    if (typeof builder !== "undefined" && builder && builder.open) return;
    // Plan mode is read-only in Phase 1. Drawing-tool shortcuts and selection
    // commands would silently mutate the drawing the user can't see, so ignore
    // them entirely. Non-canvas commands (file menu, mode toggle) get their
    // own handlers and are unaffected.
    if (state.viewMode === "plan") return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === " " && !state.spaceDown) {
      state.spaceDown = true;
      wrap.classList.add("tool-pan");
      e.preventDefault();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "d") {
      if (state.tool === "select" && state.selection.size > 0) {
        duplicateSelected();
        render();
        e.preventDefault();
      }
      return;
    }
    if (ctrl && e.key.toLowerCase() === "c") {
      if (state.tool === "select" && state.selection.size > 0) {
        copySelected();
        e.preventDefault();
      }
      return;
    }
    if (ctrl && e.key.toLowerCase() === "x") {
      if (state.tool === "select" && state.selection.size > 0) {
        cutSelected();
        render();
        e.preventDefault();
      }
      return;
    }
    if (ctrl && e.key.toLowerCase() === "v") {
      if (state.tool === "select") {
        pasteAt(state.cursorWorld);
        e.preventDefault();
      }
      return;
    }
    if (ctrl && e.key.toLowerCase() === "a") {
      if (state.tool === "select") {
        selectAllOnActiveLayer();
        render();
        e.preventDefault();
      }
      return;
    }
    if (ctrl && e.key.toLowerCase() === "z") {
      if (e.shiftKey) redo(); else undo();
      e.preventDefault();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "y") {
      redo();
      e.preventDefault();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.tool === "select" && state.selection.size > 0) {
        deleteSelected();
        render();
      }
      // Always swallow Backspace when the canvas owns focus — older Edge
      // and some niche browsers still navigate the page back on it,
      // which would discard any unsaved drawing work in one keystroke.
      // Delete is harmless to swallow as well.
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" ||
        e.key === "ArrowUp"   || e.key === "ArrowDown") {
      if (state.tool !== "select" || state.selection.size === 0) return;
      // Step size: half-grid when snap is on (matches the half-square nudge
      // that mouse drags produce via snapDelta); a single screen pixel
      // when snap is off so the user can fine-tune at any zoom.
      const step = state.snap
        ? state.gridSize / 2
        : 1 / effectiveScale();
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft")  dx = -step;
      if (e.key === "ArrowRight") dx =  step;
      if (e.key === "ArrowUp")    dy = -step;
      if (e.key === "ArrowDown")  dy =  step;
      nudgeSelected(dx, dy);
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      if (state.pending) { state.pending = null; render(); }
      else if (state.placing) { state.placing = null; wrap.classList.remove("placing"); render(); }
      else if (state.stairsDirection || !stairsModal.classList.contains("hidden")) { cancelStairs(); }
      // Cabinet builder: Esc discards. Matches CAD convention (AutoCAD,
      // SketchUp, Revit) where Esc always cancels the current command —
      // committing is what the explicit Finish button is for.
      else if (state.cabinetBuilder) { cancelCabinetBuilder(); }
      else if (state.tool === "select" && state.selection.size > 0) {
        state.selection.clear();
        render();
      }
      return;
    }
    if (e.key === "Shift") {
      state.shiftDown = true;
      if (state.pending) render();
      // Mid-drag: re-apply the active transform so the axis-lock (move) /
      // aspect-lock (resize) / fine-snap (rotate) takes effect without
      // requiring further cursor motion.
      if (state.selectionMode === "move") {
        applyMove(state.cursorWorld, e);
        render();
      } else if (state.selectionMode === "resize") {
        applyResize(state.cursorWorld, e);
        render();
      } else if (state.selectionMode === "rotate") {
        applyRotate(state.cursorWorld, e);
        render();
      }
      return;
    }
    if (ctrl) return;

    const k = e.key.toLowerCase();

    // Cabinet builder side flip — only active while the builder is up so it
    // doesn't shadow a future tool shortcut on F.
    if (k === "f" && state.cabinetBuilder) {
      flipCabinetSide();
      e.preventDefault();
      return;
    }

    if (k === "v") setTool("select");
    else if (k === "l") setTool("line");
    else if (k === "b") setTool("box");
    else if (k === "t") setTool("text");
    else if (k === "s") setTool("stairs");
    else if (k === "m") setTool("measure");
    else if (k === "h") setTool("pan");
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      state.spaceDown = false;
      if (!state.panning) {
        wrap.classList.remove("tool-pan");
        wrap.classList.add("tool-" + state.tool);
      }
    } else if (e.key === "Shift") {
      state.shiftDown = false;
      if (state.pending) render();
      if (state.selectionMode === "move") {
        applyMove(state.cursorWorld, e);
        render();
      } else if (state.selectionMode === "resize") {
        applyResize(state.cursorWorld, e);
        render();
      } else if (state.selectionMode === "rotate") {
        applyRotate(state.cursorWorld, e);
        render();
      }
    }
  });
}

function localPointer(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e) {
  if (state.viewMode === "plan") {
    // Plan mode supports paper-space pan via drag; zoom is wheel-driven.
    // Shape editing / marquee are still off here (the drawing's geometry
    // is read-only when looking at a sheet layout).
    planPointerDown(localPointer(e), e);
    return;
  }
  const sp = localPointer(e);
  const isPan = state.tool === "pan" || state.spaceDown || e.button === 1;
  if (isPan) { startPan(sp, e); return; }
  if (e.button !== 0) return;

  if (state.tool === "select") {
    handleSelectPointerDown(sp, e);
    canvas.setPointerCapture?.(e.pointerId);
    return;
  }

  if (state.tool === "text") {
    // Drop an empty text box at the cursor and hand the user straight to the
    // settings modal — they pick font / size / outline first and then type
    // the actual text in the modal's content field.
    const layer = activeSublayer();
    if (!layer) return;
    const wp = snapWorld(screenToWorld(sp.x, sp.y));
    pushHistory();
    const shape = {
      id: makeId("X"),
      type: "text",
      x: wp.x,
      y: wp.y,
      text: "",
      fontSize: DEFAULT_TEXT_SIZE_PX,
      fontFamily: DEFAULT_TEXT_FONT_FAMILY,
      outline: "none",
      angle: 0,
    };
    layer.shapes.push(shape);
    setTool("select");
    state.selection.clear();
    state.selection.add(shape.id);
    render();
    return;
  }

  if (state.tool === "stairs") {
    // First click sets the start. Drag, then release to commit direction and open modal.
    const wp = snapWorld(screenToWorld(sp.x, sp.y));
    state.stairsDirection = { start: wp };
    canvas.setPointerCapture?.(e.pointerId);
    render();
    return;
  }

  if (state.tool === "line" || state.tool === "measure") {
    const rawWorld = screenToWorld(sp.x, sp.y);
    const startWorld = state.tool === "measure" ? snapMeasurePoint(rawWorld) : snapWorld(rawWorld);
    if (!state.pending) {
      state.pending = { type: state.tool, start: startWorld };
    } else {
      const a = state.pending.start;
      const end = constrainLine(a, screenToWorld(sp.x, sp.y), e.shiftKey);
      const b = state.tool === "measure" ? snapMeasurePoint(end) : snapWorld(end);
      if (a.x !== b.x || a.y !== b.y) {
        const layer = state.pending.type === "measure" ? getMeasurementsLayer() : activeSublayer();
        if (layer) {
          pushHistory();
          const shape = {
            id: makeId("X"),
            type: state.pending.type,
            x1: a.x, y1: a.y,
            x2: b.x, y2: b.y,
          };
          if (state.pending.type === "measure") {
            shape.offset = computeMeasureOffset(a, b, screenToWorld(sp.x, sp.y));
            shape.dimType = "center";
          }
          layer.shapes.push(shape);
          renderLayerTree();
          // Auto-select newly drawn lines (not measures) so the line modal —
          // including the wall-thickness picker for Walls-layer lines — pops
          // up immediately without an extra click.
          if (state.pending.type === "line") {
            state.selection.clear();
            state.selection.add(shape.id);
          }
        }
      }
      state.pending = null;
    }
    render();
  }

  if (state.tool === "box") {
    const wp = snapWorld(screenToWorld(sp.x, sp.y));
    if (!state.pending) {
      state.pending = { type: "box", start: wp };
    } else {
      const a = state.pending.start;
      const b = wp;
      if (a.x !== b.x && a.y !== b.y) {
        const layer = activeSublayer();
        if (layer) commitBox(layer, a, b);
      }
      state.pending = null;
    }
    render();
  }

  if (state.tool === "cabinet" && state.cabinetBuilder) {
    const wp = screenToWorld(sp.x, sp.y);
    placeCabinetPoint(wp);
    render();
  }
}

function onPointerMove(e) {
  if (state.viewMode === "plan") {
    planPointerMove(localPointer(e));
    return;
  }
  const sp = localPointer(e);
  state.cursorScreen = sp;
  const wp = screenToWorld(sp.x, sp.y);
  state.cursorWorld = wp;
  state.shiftDown = !!e.shiftKey;

  const display = state.snap ? snapWorld(wp) : wp;
  statusPos.textContent = `${formatFeet(display.x)}, ${formatFeet(display.y)}`;

  if (state.panning) {
    const dx = sp.x - state.panStart.x;
    const dy = sp.y - state.panStart.y;
    state.pan.x = state.panOrigin.x + dx;
    state.pan.y = state.panOrigin.y + dy;
    render();
    return;
  }

  if (state.placing) { render(); return; }

  if (state.tool === "select") {
    if (state.selectionMode) handleSelectPointerMove(wp, e);
    else updateSelectCursor(sp);
    return;
  }

  if (state.tool === "stairs" && state.stairsDirection) {
    render();
    return;
  }

  if (state.tool === "cabinet" && state.cabinetBuilder) {
    render();
    return;
  }

  if (state.pending) render();
  else if (state.tool === "measure") render();
  else if (state.snap && (state.tool === "line" || state.tool === "box")) render();
}

function onPointerUp(e) {
  if (state.viewMode === "plan") {
    planPointerUp(e);
    return;
  }
  if (state.panning) { endPan(); return; }
  if (state.tool === "select" && state.selectionMode) {
    finishSelectionAction();
    canvas.releasePointerCapture?.(e.pointerId);
    return;
  }
  if (state.tool === "stairs" && state.stairsDirection) {
    const start = state.stairsDirection.start;
    const end = getStairsArrowEnd();
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) {
      // Treat as a click without a real drag — cancel
      state.stairsDirection = null;
      render();
    } else {
      state.stairsDirection.angle = Math.atan2(dy, dx);
      state.stairsDirection.length = len;
      showStairsModal();
      render();
    }
    canvas.releasePointerCapture?.(e.pointerId);
  }
}

function startPan(sp, e) {
  state.panning = true;
  state.panStart = sp;
  state.panOrigin = { ...state.pan };
  wrap.classList.add("panning");
  canvas.setPointerCapture?.(e.pointerId);
}

function endPan() {
  state.panning = false;
  state.panStart = null;
  state.panOrigin = null;
  wrap.classList.remove("panning");
}
