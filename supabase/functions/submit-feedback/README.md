# submit-feedback

Edge function that powers the in-app **Give Feedback** button. Accepts a
`POST` with `{ description, report }`, validates the body, and forwards the
contents to the team inbox via [Resend](https://resend.com).

The walkthrough below assumes you've never deployed a Supabase function
before. Skip ahead if you already have the CLI installed and the project
linked.

---

## Step 1 — Get a Resend API key

Resend handles the actual email-sending. Free tier is 3,000 emails/month;
beta-tester feedback won't come anywhere close to that.

1. Sign up at <https://resend.com> with the email account you want
   feedback delivered to (e.g. `hello@easydraftonline.com`).
2. After confirming your email, open <https://resend.com/api-keys>.
3. Click **Create API Key**.
   - Name: `easy-draft-feedback` (anything works)
   - Permission: **Sending access**
   - Domain: **All Domains**
4. Copy the key — it starts with `re_`. **Save it now**; Resend shows
   it exactly once.

> **⚠ Resend sandbox restriction.** Until you verify a sending domain
> (see below), Resend will only deliver mail from `onboarding@resend.dev`
> **to the email address you signed up with**. Any other recipient gets a
> `403 — You can only send testing emails to your own email address`.
> So either:
> - sign up at Resend using the same inbox you want feedback delivered
>   to (the `FEEDBACK_TO` default is `hello@easydraftonline.com`), **or**
> - while testing, point `FEEDBACK_TO` at your Resend sign-up email via
>   `supabase secrets set FEEDBACK_TO=you@example.com`, **or**
> - finish domain verification (next sub-section) so the restriction
>   lifts.

### Optional: verify your sending domain

You can use Resend's shared sender (`onboarding@resend.dev`) right away
— subject to the sandbox restriction above — but verifying a domain
lifts that restriction and lets you send to anyone. If you'd rather
emails come from `feedback@easydraftonline.com`:

1. Resend Dashboard → **Domains** → **Add Domain** → enter
   `easydraftonline.com`.
2. Resend gives you 3–4 DNS records (SPF, DKIM, return-path).
3. Add those records at your DNS provider (Cloudflare, GoDaddy,
   Namecheap, etc.).
4. Wait for Resend to mark the domain ✅ Verified (usually minutes,
   sometimes hours).

You can leave this for later and switch the `FEEDBACK_FROM` env var
once verification lands.

---

## Step 2 — Install the Supabase CLI

Pick the one for your machine:

| OS | Command |
|---|---|
| macOS (Homebrew) | `brew install supabase/tap/supabase` |
| Windows (Scoop) | `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase` |
| Cross-platform (npm) | `npm install -g supabase` |
| Other | Download from <https://github.com/supabase/cli/releases> |

Confirm with:

```sh
supabase --version
```

(should print something like `1.219.0`)

---

## Step 3 — Log in and link the project

From the **repo root** (where this README sits at
`supabase/functions/submit-feedback/`):

```sh
supabase login
```

A browser window opens — log in with the Supabase account that owns the
`dpghsqmdnvwxyaeojbfx` project (the one referenced in `js/config.js`).

Then link:

```sh
supabase link --project-ref dpghsqmdnvwxyaeojbfx
```

If it prompts for the database password, that's the password you set
when you first created the Supabase project. If you've forgotten it, you
can reset it at **Supabase Dashboard → Project Settings → Database →
Reset database password**.

---

## Step 4 — Set the function's secrets

```sh
supabase secrets set RESEND_API_KEY=re_paste_your_key_here
```

Optional overrides (defaults are baked into `index.ts`):

```sh
supabase secrets set FEEDBACK_TO=hello@easydraftonline.com
supabase secrets set FEEDBACK_FROM='Easy Draft <feedback@easydraftonline.com>'
```

If you skipped domain verification in Step 1, **don't set
`FEEDBACK_FROM`** — the default (`onboarding@resend.dev`) is the only
thing Resend will let you send from until verification clears.

Verify the secrets landed:

```sh
supabase secrets list
```

You should see `RESEND_API_KEY` (the value is hidden, that's expected).

---

## Step 5 — Deploy the function

```sh
supabase functions deploy submit-feedback
```

This bundles `supabase/functions/submit-feedback/index.ts` and uploads
it. The first deploy takes ~30 seconds. The CLI prints a function URL
matching `https://dpghsqmdnvwxyaeojbfx.supabase.co/functions/v1/submit-feedback`
— that's the URL `js/config.js` is already pointing at.

Confirm in the dashboard: **Supabase → Edge Functions** → you should
see `submit-feedback` listed with a green ✅.

---

## Step 6 — Send a test from the command line

Replace nothing — these are the real keys from `js/config.js`:

```sh
curl -i -X POST 'https://dpghsqmdnvwxyaeojbfx.supabase.co/functions/v1/submit-feedback' \
  -H 'Content-Type: application/json' \
  -H 'apikey: sb_publishable_DZAup0w4vG7gsRddZpmQQQ_eXNR8zzu' \
  -H 'Authorization: Bearer sb_publishable_DZAup0w4vG7gsRddZpmQQQ_eXNR8zzu' \
  -d '{"description":"Hello from curl","report":{"screen":"Draw","tool":"line","recentActions":[]}}'
```

Success: HTTP `200` and `{"ok":true}` in the body. Within a few seconds
the email lands in your inbox.

On failure, the function passes Resend's own error message back in the
response body — e.g. an HTTP `502` with
`{"error":"email send failed","status":403,"resend_error":"validation_error","message":"You can only send testing emails to your own email address (you@example.com)."}`.
Match the `message` against the table below.

If you'd rather watch it server-side, **stream the function logs** in
another terminal:

```sh
supabase functions logs submit-feedback --tail
```

---

## Step 7 — Click the button in the actual app

Open the deployed app, click **Give Feedback**, type a quick note,
click **Send feedback**. The status line should read
"Thanks! Your feedback was sent." within ~1 second, and a second email
should arrive.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Client shows "Server returned 401" | Gateway rejected the request | Confirm `verify_jwt = false` for the function in `supabase/config.toml` (it is in this repo). Redeploy if you edited the config. |
| Client shows "Server returned 503 — email transport not configured" | `RESEND_API_KEY` secret isn't set | `supabase secrets list`. If missing, re-run `supabase secrets set RESEND_API_KEY=…`. |
| `curl` returns 502 with `"message":"You can only send testing emails to your own email address"` | Resend's sandbox lets `onboarding@resend.dev` deliver only to the address that owns the Resend account. | Either sign up at Resend with the same inbox you set as `FEEDBACK_TO`, run `supabase secrets set FEEDBACK_TO=your-resend-signup@example.com` while testing, or verify a sending domain and switch `FEEDBACK_FROM` to an address on it. |
| `curl` returns 502 with a different Resend message (e.g. "The `from` address is not a verified domain") | `FEEDBACK_FROM` points at a domain Resend hasn't verified yet | Unset `FEEDBACK_FROM` (the default falls back to `onboarding@resend.dev`) or finish domain verification in the Resend dashboard. |
| Client shows "Server returned 502 — email send failed" but no `message` field | Older deploy of the function — it didn't surface Resend's message yet | Redeploy: `supabase functions deploy submit-feedback`. Then re-run the curl and the response body will include the Resend error message. Or read it directly with `supabase functions logs submit-feedback --tail`. |
| Client shows "Server returned 413" | Description longer than 8000 chars | Trim the note. (The textarea doesn't enforce this — adding a client-side counter is a future polish.) |
| Email lands in spam | Sender domain isn't verified, or SPF/DKIM still propagating | Verify the domain in Resend, wait a few hours for DNS, mark "Not Spam" once. |
| `supabase functions deploy` fails with "permission denied" | Wrong account linked, or 2FA token expired | Re-run `supabase login`. |

---

## Updating the function later

The deploy is idempotent — edit `index.ts`, then re-run:

```sh
supabase functions deploy submit-feedback
```

No code change in the client (`js/feedback.js` / `js/config.js`) is
needed unless you change the function's URL or request schema.

---

## Local testing without deploying

```sh
# Drop your test key in a gitignored .env.local at the repo root
echo 'RESEND_API_KEY=re_paste_your_key_here' > supabase/.env.local

supabase functions serve submit-feedback --env-file supabase/.env.local
```

In another shell:

```sh
curl -X POST http://localhost:54321/functions/v1/submit-feedback \
  -H 'Content-Type: application/json' \
  -d '{"description":"local test","report":{"screen":"Draw","tool":"line"}}'
```

(Local serving skips the gateway, so no apikey header is needed.)

---

## Swapping email providers later

The function calls Resend with a single `fetch`. To switch to SendGrid,
Postmark, Mailgun, etc., replace the `fetch(...)` block in `index.ts`
with the equivalent API call. The rest of the function (CORS, request
validation, payload shape, env vars) is provider-agnostic.
