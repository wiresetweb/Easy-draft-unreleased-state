'use strict';

// ==============================================================================
// Project autocache — keep an in-progress drawing in localStorage so an
// accidental refresh / tab close doesn't lose the user's work.
//
// We piggy-back on serializeDocument() / loadDocument() so the cache uses the
// exact same shape as a saved .dstudio.json file. On init we look for a cached
// document and silently restore it; otherwise the app starts fresh.
//
// Save points:
//   • debounced after every pushHistory() — covers all drawing edits
//   • periodic 30s timer — covers sheet / notes / unit edits that don't go
//     through history
//   • on visibilitychange/pagehide/beforeunload — last-chance flush
//
// Cache is cleared by fileNew() so a fresh document doesn't immediately get
// overwritten by the previous session's snapshot.
// ==============================================================================

const CACHE_STORAGE_KEY = "easydraft.autocache.v1";
const CACHE_DEBOUNCE_MS = 1000;
const CACHE_INTERVAL_MS = 30000;

let _cacheDebounceTimer = null;
let _cacheIntervalTimer = null;

function buildCachePayload() {
  const doc = serializeDocument();
  // fileName isn't part of the on-disk format, but we want the brand label
  // and Save behavior to pick up where the user left off after a refresh.
  // (fileHandle can't survive — it's an opaque browser object.)
  return { ...doc, _cachedFileName: state.fileName || null };
}

function saveCacheNow() {
  try {
    const json = JSON.stringify(buildCachePayload());
    localStorage.setItem(CACHE_STORAGE_KEY, json);
  } catch (_) {
    // Quota exceeded or private mode — drop the cache rather than wedging
    // future saves with a stale half-written entry.
    try { localStorage.removeItem(CACHE_STORAGE_KEY); } catch (_) {}
  }
}

function scheduleCacheSave() {
  if (_cacheDebounceTimer) clearTimeout(_cacheDebounceTimer);
  _cacheDebounceTimer = setTimeout(() => {
    _cacheDebounceTimer = null;
    saveCacheNow();
  }, CACHE_DEBOUNCE_MS);
}

function clearCachedDocument() {
  if (_cacheDebounceTimer) {
    clearTimeout(_cacheDebounceTimer);
    _cacheDebounceTimer = null;
  }
  try { localStorage.removeItem(CACHE_STORAGE_KEY); } catch (_) {}
}

// Returns true if a cached document was successfully restored; false otherwise.
// Called from init() before the default story is created.
function tryRestoreCachedDocument() {
  let raw = null;
  try { raw = localStorage.getItem(CACHE_STORAGE_KEY); } catch (_) { return false; }
  if (!raw) return false;
  let data;
  try { data = JSON.parse(raw); } catch (_) {
    clearCachedDocument();
    return false;
  }
  if (!data || !Array.isArray(data.stories) || data.stories.length === 0) {
    return false;
  }
  // loadDocument() expects the same shape serializeDocument() produces, plus
  // alerts on bad input — guard with a try in case a future schema bump makes
  // an old cache unparseable.
  let restored = false;
  try {
    restored = loadDocument(data);
  } catch (err) {
    console.error("Failed to restore cached document:", err);
    clearCachedDocument();
    return false;
  }
  if (!restored) return false;
  if (typeof data._cachedFileName === "string") {
    state.fileName = data._cachedFileName;
  }
  return true;
}

function startCacheAutosave() {
  if (_cacheIntervalTimer) clearInterval(_cacheIntervalTimer);
  _cacheIntervalTimer = setInterval(saveCacheNow, CACHE_INTERVAL_MS);

  // Last-chance flush. visibilitychange fires reliably on mobile where
  // beforeunload often doesn't; pagehide covers bfcache transitions.
  const flush = () => {
    if (_cacheDebounceTimer) {
      clearTimeout(_cacheDebounceTimer);
      _cacheDebounceTimer = null;
    }
    saveCacheNow();
  };
  window.addEventListener("beforeunload", flush);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
