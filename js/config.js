'use strict';

// ==============================================================================
// Public configuration constants. Mirrors easydraftonline.com's js/config.js
// so the drafting tool at /app/ can talk to the same Supabase project as the
// marketing site without an HTTP fetch (which would break file:// dev).
//
// These keys are publishable / anon — safe to ship in client JS. The
// entitlement table is row-locked by RLS on the server.
// ==============================================================================

const SUPABASE_URL = "https://dpghsqmdnvwxyaeojbfx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DZAup0w4vG7gsRddZpmQQQ_eXNR8zzu";

// Where the Buy Pro button + the upgrade prompts on free-user exports
// link to. Open in a new tab so the user doesn't lose their drawing.
const CHECKOUT_URL = "https://easydraftonline.lemonsqueezy.com/checkout";

// Supabase edge function endpoint for the Give Feedback button. Function
// source lives in supabase/functions/submit-feedback/. Leave blank to
// fall back to a mailto: link.
const FEEDBACK_FUNCTION_URL = SUPABASE_URL + "/functions/v1/submit-feedback";
