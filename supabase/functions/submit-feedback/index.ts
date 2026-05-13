// Supabase Edge Function — submit-feedback
//
// Accepts a POST with { description, report } from the in-app Give Feedback
// modal, validates the body, and forwards the contents to the team inbox via
// Resend (https://resend.com). Resend was picked because it's free up to
// 3000 emails / month and the API is a single fetch — exactly the volume
// "I don't anticipate too much" sounds like.
//
// Setup:
//   1. supabase login
//   2. supabase functions deploy submit-feedback
//   3. supabase secrets set RESEND_API_KEY=<your key>            (required)
//      supabase secrets set FEEDBACK_TO=hello@easydraftonline.com (optional)
//      supabase secrets set FEEDBACK_FROM="Easy Draft <feedback@easydraftonline.com>"  (optional)
//
// The FEEDBACK_FROM domain must be verified in your Resend dashboard. Until
// you finish that, leave FEEDBACK_FROM unset and the function falls back to
// Resend's shared "onboarding@resend.dev" sender — but note that the shared
// sender will *only* deliver to the email address that owns the Resend
// account (Resend returns 403 for any other recipient). So FEEDBACK_TO has
// to match your Resend sign-up email during the sandbox phase, or you need
// a verified domain.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO") || "hello@easydraftonline.com";
const FEEDBACK_FROM = Deno.env.get("FEEDBACK_FROM") || "Easy Draft <onboarding@resend.dev>";

// Permissive CORS — the app is served from easydraftonline.com but devs
// also test from file:// and localhost. The function just relays a
// best-effort feedback ping so locking down origins isn't worth it.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  let body: { description?: string; report?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON" }, 400);
  }

  const description = (body.description || "").toString().trim();
  // Length guard — the textarea shouldn't yield massive payloads, but a
  // misbehaving client (or a mischievous one) could try.
  if (!description) return jsonResponse({ error: "description required" }, 400);
  if (description.length > 8000) return jsonResponse({ error: "description too long" }, 413);

  const report = (body.report && typeof body.report === "object") ? body.report : {};

  if (!RESEND_API_KEY) {
    // Function is deployed but unconfigured — log loudly so the operator
    // notices, and fail closed so the client can surface the error.
    console.error("RESEND_API_KEY not set — cannot send feedback email");
    return jsonResponse({ error: "email transport not configured" }, 503);
  }

  const subject = buildSubject(report);
  const { html, text } = buildEmailBody(description, report);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FEEDBACK_FROM,
        to: [FEEDBACK_TO],
        subject,
        html,
        text,
        reply_to: undefined, // anonymous beta feedback — no user email collected
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Resend API error", res.status, detail);
      // Surface Resend's own error message in the body so a curl response
      // (or the in-app fetch) shows the real cause without having to tail
      // `supabase functions logs`. Resend's error payloads are a small JSON
      // blob — { statusCode, name, message } — and never include the API
      // key, so passing the message through is safe.
      const parsed = parseResendError(detail);
      return jsonResponse(
        {
          error: "email send failed",
          status: res.status,
          ...(parsed.name ? { resend_error: parsed.name } : {}),
          ...(parsed.message ? { message: parsed.message } : {}),
        },
        502,
      );
    }
  } catch (err) {
    console.error("Resend fetch threw", err);
    return jsonResponse({ error: "email transport unreachable" }, 502);
  }

  return jsonResponse({ ok: true });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function buildSubject(report: Record<string, unknown>): string {
  const screen = (report.screen as string) || "Easy Draft";
  const tool = report.tool ? ` — ${report.tool}` : "";
  return `[Easy Draft feedback] ${screen}${tool}`;
}

function buildEmailBody(description: string, report: Record<string, unknown>): { html: string; text: string } {
  const reportText = JSON.stringify(report, null, 2);
  const safeDesc = escapeHtml(description);
  const safeReport = escapeHtml(reportText);
  const html = `
    <div style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1a2a36;">
      <h2 style="margin: 0 0 12px;">New beta feedback</h2>
      <p style="white-space: pre-wrap; background: #f6f8fb; padding: 12px 14px; border-radius: 6px; border: 1px solid #e2e8f0;">${safeDesc}</p>
      <h3 style="margin: 24px 0 8px; font-size: 14px; color: #475569;">Diagnostic report</h3>
      <pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap;">${safeReport}</pre>
    </div>
  `.trim();
  const text = `New beta feedback\n\n${description}\n\n--- Diagnostic report ---\n${reportText}\n`;
  return { html, text };
}

// Resend errors are JSON like { statusCode, name, message }. Some
// gateway-side failures come back as plain text instead, so fall back to
// the raw string when the body isn't parseable.
function parseResendError(raw: string): { name?: string; message?: string } {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      const name = typeof obj.name === "string" ? obj.name : undefined;
      const message = typeof obj.message === "string" ? obj.message : undefined;
      if (name || message) return { name, message };
    }
  } catch {
    // Fall through to plain-text handling below.
  }
  // Cap the message so a runaway HTML error page doesn't bloat the response.
  return { message: raw.slice(0, 500) };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
