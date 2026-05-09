# submit-feedback

Edge function that powers the in-app **Give Feedback** button. Accepts a
`POST` with `{ description, report }`, validates the body, and forwards the
contents to the team inbox via [Resend](https://resend.com).

## One-time setup

1. **Sign up for Resend** (free tier is 3,000 emails / month). Create an
   API key from <https://resend.com/api-keys>.
2. **Verify your sending domain** in the Resend dashboard. While the DNS
   records propagate you can use Resend's `onboarding@resend.dev`
   shared sender — it'll deliver to your verified inbox without DNS work.
3. **Set the function's secrets** in your Supabase project:

   ```sh
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
   # Optional overrides — defaults are baked in:
   supabase secrets set FEEDBACK_TO=hello@easydraftonline.com
   supabase secrets set FEEDBACK_FROM='Easy Draft <feedback@easydraftonline.com>'
   ```

4. **Deploy** the function:

   ```sh
   supabase functions deploy submit-feedback
   ```

JWT verification is disabled in `supabase/config.toml` so unauthenticated
beta users can submit. The Supabase gateway still requires the project's
publishable `apikey` header, which the client sends from `js/config.js`.

## Local testing

```sh
supabase functions serve submit-feedback --env-file .env.local
curl -X POST http://localhost:54321/functions/v1/submit-feedback \
  -H 'Content-Type: application/json' \
  -d '{"description":"test","report":{"screen":"Draw","tool":"line"}}'
```

`.env.local` should contain `RESEND_API_KEY=...` (don't commit it).

## Swapping email providers

The function calls Resend with a single `fetch`. If you want to use
SendGrid, Postmark, Mailgun, or anything else, replace the `fetch` block
in `index.ts` with the equivalent API call. The rest of the function
(validation, payload shape, CORS) is provider-agnostic.
