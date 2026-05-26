'use strict';

// ==============================================================================
// Public configuration constants.
//
// SCRUBBED FOR THIS ISOLATED CLONE: every outbound endpoint is intentionally
// blank so the app never communicates with any external service. With the
// Supabase URL/key empty, js/auth.js bails before loading the CDN SDK or
// querying Supabase (the visitor simply stays "unpaid"). With the feedback
// URL empty, js/feedback.js falls back to a mailto: link instead of POSTing.
// The production values lived here and mirror easydraftonline.com's
// js/config.js — restore them there, not in this clone, if the network
// integration is ever re-enabled.
// ==============================================================================

const SUPABASE_URL = "";
const SUPABASE_PUBLISHABLE_KEY = "";

// Buy Pro button / upgrade-prompt link. Blank in this clone → the button is
// inert (href falls back to "#") rather than pointing at the checkout.
const CHECKOUT_URL = "";

// Supabase edge function endpoint for the Give Feedback button. Blank → the
// feedback flow falls back to a mailto: link, with no network call.
const FEEDBACK_FUNCTION_URL = "";
