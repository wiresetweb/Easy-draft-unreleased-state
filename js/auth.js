'use strict';

// ==============================================================================
// Entitlement check — sets state.paid based on the visitor's Supabase session.
//
// The drafting tool runs at /app/ on easydraftonline.com (same-origin as the
// marketing site, so an existing logged-in cookie is picked up automatically).
// We dynamically pull the Supabase JS UMD bundle from a CDN, look up the
// current session, then query the `entitlements` row to confirm the visitor
// owns the base product.
//
// Failure modes — all degrade to "unpaid" so the export watermark applies:
//   • file:// origin (offline dev, README's non-negotiable mode)
//   • CDN unreachable
//   • Supabase API unreachable / errors
//   • No session (user not logged in)
//   • No active entitlement row
//
// Server-side gating is intentionally not the point. For a $39 client-side
// tool the watermark is bypassable by anyone who edits the JS — that's an
// accepted tradeoff. The bar is "a non-paying user can't pass off the export
// as a finished drawing", not "a determined user can't get clean output".
// ==============================================================================

// Default to unpaid until proven otherwise. The export pipeline reads this
// at render time, so a slow-arriving entitlement won't break correctness;
// it'll just mean the first export immediately after page load might be
// watermarked even for a paying user. The retry logic below limits that
// window to roughly the time it takes one network round-trip to complete.
state.paid = false;

// Topbar badge + Buy Pro link — flip between "Free" / "Pro" based on
// state.paid. Safe to call before the DOM is fully painted (no-ops if
// the elements aren't there yet) so callers don't have to know about
// init ordering.
function updatePlanBadge() {
  const el = document.getElementById("plan-badge");
  const buyLink = document.getElementById("buy-pro-link");
  if (el) {
    if (state.paid) {
      el.textContent = "Pro";
      el.classList.remove("plan-badge-free");
      el.classList.add("plan-badge-pro");
      el.title = "Pro version — exports are clean";
    } else {
      el.textContent = "Free";
      el.classList.remove("plan-badge-pro");
      el.classList.add("plan-badge-free");
      el.title = "Free version — exports are watermarked";
    }
  }
  if (buyLink) {
    if (state.paid) {
      buyLink.hidden = true;
    } else {
      buyLink.hidden = false;
      // Pull the URL fresh each time so config.js edits don't require
      // a hard reload to pick up.
      const url = (typeof CHECKOUT_URL === "string" && CHECKOUT_URL) ? CHECKOUT_URL : "#";
      buyLink.href = url;
    }
  }
}

const SUPABASE_SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

(function bootstrapEntitlement() {
  // file:// — Supabase fetch can't possibly succeed (and shouldn't be tried;
  // CDN script element from a file:// page hits CORS / mixed-protocol issues
  // on some browsers). Stay unpaid silently.
  if (typeof window === "undefined") return;
  if (window.location.protocol === "file:") return;
  if (typeof SUPABASE_URL !== "string" || !SUPABASE_URL) return;
  if (typeof SUPABASE_PUBLISHABLE_KEY !== "string" || !SUPABASE_PUBLISHABLE_KEY) return;

  const tag = document.createElement("script");
  tag.src = SUPABASE_SDK_URL;
  tag.async = true;
  tag.onload = () => {
    try {
      const lib = window.supabase;
      if (!lib || typeof lib.createClient !== "function") return;
      const sb = lib.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      checkEntitlement(sb);
    } catch (err) {
      console.warn("[easy-draft] entitlement bootstrap failed:", err);
    }
  };
  tag.onerror = () => {
    console.warn("[easy-draft] supabase SDK failed to load — staying unpaid");
  };
  document.head.appendChild(tag);
})();

async function checkEntitlement(sb) {
  try {
    const sessionRes = await sb.auth.getSession();
    const session = sessionRes && sessionRes.data && sessionRes.data.session;
    if (!session || !session.user) return; // anonymous visitor → watermark

    const { data, error } = await sb
      .from("entitlements")
      .select("status")
      .eq("user_id", session.user.id)
      .eq("product_id", "base")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[easy-draft] entitlement query error:", error.message || error);
      return;
    }
    if (data && data.status === "active") {
      state.paid = true;
      updatePlanBadge();
    }
  } catch (err) {
    console.warn("[easy-draft] entitlement check failed:", err);
  }
}
