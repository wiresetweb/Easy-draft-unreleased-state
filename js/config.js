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
