# Going live

Owner actions to take RouteKeep from local development to a hosted pilot. The
code needs no changes for any of these; each is an account, a setting or a
secret only the owner can create. Budget references are PRD section 5.

## 1. Supabase project (Free while there is only demo data, BUD-02)

1. Create a project (US West is closest to Utah). Save the project ref, URL,
   anon key and service-role key in a password manager.
2. Apply the schema from this repository:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   `db push` applies `supabase/migrations` only. It never runs `seed.sql`.
3. Authentication > Hooks > Custom Access Token: select
   `public.custom_access_token_hook`. Without it, nobody gets a tenant claim and
   every screen redirects to onboarding.
4. Authentication > Email templates > Magic link: include `{{ .Token }}` so the
   email carries the 6-digit code people type into the app (links open Safari,
   not an installed PWA).
5. Authentication > URL configuration: Site URL = the app's URL.
6. Restricted database login (recommended). In the SQL editor, with a long
   random password:
   ```sql
   create role routekeep_app login noinherit password '<generated>';
   grant authenticated, service_role to routekeep_app;
   ```
   This role owns nothing and can do nothing until the app switches to
   `authenticated` (requests) or `service_role` (jobs), so a query that forgets
   to switch fails instead of bypassing RLS (verified against a local Postgres 16).
   Use the transaction pooler URL:
   `postgresql://routekeep_app.<ref>:<password>@<pooler-host>:6543/postgres`.
   Not yet verified on a hosted project: if Supabase refuses the `grant`, skip
   this step and use the default pooler user; RLS still applies because every
   request switches to `authenticated` in `withRls`.
7. API settings: remove `public` from the Data API's exposed schemas. The app
   talks to Postgres directly; RLS and grants are designed to be safe either way,
   but there is no reason to expose it.
8. Before the first real customer record: upgrade to Pro ($25/month) and run a
   test restore (CR-09, BUD-02). Then delete `.github/workflows/supabase-keepalive.yml`.

## 2. Netlify (Free, D-03)

1. New site from the GitHub repository; Next.js is detected automatically.
2. Build settings: deploy from `main` only, deploy previews off (BUD-04).
3. Environment variables (section 18 of the PRD):
   `AUTH_MODE=supabase`, `APP_URL`, `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
   `GOOGLE_MAPS_API_KEY` if you want automatic pins. Never set `AUTH_MODE=local`
   or `LOCAL_AUTH_SECRET` on Netlify; the app refuses to start that way anyway.
4. Set a usage alert at 80% of credits (RISK-02).

## 3. GitHub

- Actions secrets for the keepalive: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Branch protection on `main`: require the CI workflow.

## 4. Inngest (Free, D-04): nightly visit generation

1. Create an Inngest account and app; record the free-tier limits in
   `docs/VENDORS.md` (BUD-05).
2. Add `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to Netlify.
3. In the Inngest dashboard, sync the app at `https://<app-url>/api/inngest`.
   Two functions appear: `generation-nightly` (cron, 02:15 Mountain) fans out
   one `generation/tenant.requested` event per tenant, and `generation-tenant`
   keeps each tenant's visits 60 days ahead in idempotent batches.

Until this is done the endpoint answers 500 by design (it refuses unsigned
calls), and visits are still generated whenever a plan is sold or resumed.
Locally: `npx inngest-cli@latest dev` plus `INNGEST_DEV=1`, or just
`npm run db:generate`.

## 5. Later milestones

PowerSync (M3), Stripe Connect (M4), Resend and per-tenant 10DLC (M6),
Sentry. Each gets a row in `docs/VENDORS.md` with its real free-tier limits at
signup (BUD-05).
