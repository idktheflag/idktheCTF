# CTFv on Cloudflare

idktheCTF is a lightweight, team-scored Jeopardy CTF platform. It runs as one Cloudflare Worker serving the frontend and Hono API, with D1 for application data, R2 for private challenge files, and Cloudflare Email Service for verification. Wrangler configures the runtime.

## Features

- Team-only play. A solo competitor creates a one-person team; team join codes and maximum team size are supported.
- Team leaderboard, challenge solving, flag attempts, team-scoped solve deduplication, and paid/free hints.
- Custom challenge categories, Markdown descriptions, multiple exact or bounded regex flags, tags, visibility, attempt limits, and private attachments.
- Event schedule, pause, public/private scoreboard, score freeze, and post-event challenge visibility.
- Announcements, organizer pages, participant/team moderation, audit logs, dashboard statistics, and JSON export.
- Email verification through Cloudflare Email Service from `no-reply@idktheflag.sh`.
- Verified owner account bootstrap from the configured `OWNER_EMAIL`; no onboarding wizard or seeded password.

The platform intentionally omits plugin compatibility, dynamic challenge containers, SSO, and attack/defense orchestration.

## Local development

1. Install Node.js 22.18 or newer and run `npm ci` at the repository root. The npm lockfile is the authoritative dependency lock.
2. Copy `packages/ctfv-backend/.dev.vars.example` to `packages/ctfv-backend/.dev.vars`. Set a unique `AUTH_SECRET`, `OWNER_EMAIL` to the organizer email, and `APP_URL=http://localhost:5173` for frontend email links.
3. Apply migrations to Wrangler's local D1: `npm run migration:local --workspace=ctfv-backend`.
4. Start the frontend and Worker in separate terminals: `npm run dev --workspace=ctfv-frontend` and `npm run dev --workspace=ctfv-backend`.
5. Open `http://localhost:5173`, register the owner using the configured `OWNER_EMAIL` and leave username blank, then verify the email to receive organizer access. Set the event schedule and other options in **Admin → Event settings**.

Wrangler's local D1 and R2 are isolated from production. The local email binding simulates delivery and logs messages; it does not send mail. Keep `.dev.vars` private. The first account is not automatically promoted until its email is verified and matches `OWNER_EMAIL`.

## Cloudflare deployment configuration

The Worker custom domain is `ctf.idktheflag.sh`. Before deploying, confirm that the `idktheflag.sh` zone and configured D1 database belong to the intended Cloudflare account. This repository does not provision or deploy resources automatically.

1. Create the production D1 database if needed and set its ID as `database_id` in `packages/ctfv-backend/wrangler.toml`.
2. Create the configured R2 bucket `ctfv-challenge-files` for private attachments.
3. Apply production migrations from `packages/ctfv-backend` with `wrangler d1 migrations apply ctfV-db --remote`.
4. Onboard `idktheflag.sh` in Cloudflare Email Service. Set `AUTH_SECRET` and `OWNER_EMAIL` as Worker secrets; use `wrangler secret put OWNER_EMAIL` and ensure the sender is enabled for the zone.
5. Run `npm run check` (also available as `npm run deploy:check`) to run backend type checks, frontend lint, all regression tests, the production frontend build, and a Wrangler deployment dry run. Build and deploy from the root with `npm run deploy`; it runs the same checks and stops before uploading if any check fails. Static assets are served directly by Workers Static Assets; only `/api/*` invokes the Worker. Frontend requests always use the same-origin API, including through the Vite development proxy. No separate frontend hosting or CORS configuration is required.
6. Register the owner using the configured `OWNER_EMAIL` with no username, verify that email, then configure event dates and settings in the organizer console.

The deployment commands above target production only when explicitly run. Use `wrangler dev` for local work; do not use `--remote` for local migrations.

## Organizer operations

The organizer sidebar includes event settings, challenge authoring, team controls, content pages, and the activity log. The Participants and Teams screens provide account and team moderation; admins use email and password only and do not appear as leaderboard participants. Team tables support server-side search, filters, sorting, and pagination; challenge browsing supports category, name/tag search, and point ordering. Audit metadata is bounded and redacted; it does not store credentials, flags, raw submissions, or uploaded file contents.

Challenge attachments use resumable R2 multipart uploads. The application does not impose a 10 MB limit. Cloudflare Worker request limits still apply to each uploaded part, and R2 imposes its own per-object multipart limits. Upload sessions expire after seven days; admins can cancel an unfinished upload and retry by reselecting its file. For local iteration, run `npx wrangler dev` from `packages/ctfv-backend`; its local D1/R2 state is isolated from production and local email is simulated.

## Event-day runbook

- Before opening registration, confirm the event name, IANA timezone, start/end times, team size, allowed email domains, and public/invitation registration mode in Event settings. Invitations are single-use, tied to the exact email, and expire after seven days.
- Verify the owner mailbox and retain Cloudflare operator recovery access before the event. Organizer access is granted only to a verified account matching `OWNER_EMAIL`; administrators authenticate with email and password and have no participant username/team.
- Upload challenge files, open each challenge in the admin view, verify points/flags/hints/attachments, and check the participant view with a non-admin test team. Never include real flags in titles, descriptions, announcements, or audit notes.
- Confirm `/api/health` reports `{"ok":true,"database":"ok"}`. Check challenge access, test a deliberately wrong flag, test one valid solve, and confirm the scoreboard updates. Rehearse pausing submissions and freezing the scoreboard.
- Take a D1 export before migrations and before the event. Example: `npx wrangler d1 export ctfV-db --remote --output=./backups/pre-event.sql` from the backend package. Store backups outside the repo with restricted access. To restore, create a separate recovery database, import the reviewed SQL there first, validate event/users/teams/solves, then update the configured database binding only under a deliberate recovery procedure. Do not restore over a live event database as an exploratory step.
- Keep the existing Worker version available for rollback. For an application rollback, redeploy the last known-good Worker bundle. Database migrations are additive; do not roll back schema by deleting tables. Take and validate a backup before applying a forward repair migration.
- During the event, watch Worker logs for sanitized request status/error records and review Admin → Activity log for organizer actions. Native login, recovery, verification-mail and registration limits apply to identities, plus an aggregate IP limit sized separately for shared networks. They are approximate per Cloudflare location and are abuse friction, not global lockouts or DDoS protection. Configured limiter failures reject attempts; local development may omit the bindings.
- After the event, freeze the scoreboard at the intended time, keep a backup, export results, and decide whether challenge visibility should remain enabled before changing registration or team access.

Required production configuration includes the D1 database, R2 bucket, Cloudflare Email Service sender, `AUTH_SECRET`, and `OWNER_EMAIL`. Treat secrets and SQL exports as sensitive; never commit them. Wrangler rate-limit bindings are configured in `wrangler.toml` and should be checked in a deploy dry run before release.

## Data compatibility

Migrations preserve existing user and challenge IDs and historical submissions. Existing participants are assigned one-person teams, existing flags are copied into the separate flag table, and existing event configuration fields are preserved when the singleton event row is renamed to `idktheCTF`.

## Authentication upgrade

Migration `0010_auth_version.sql` adds a D1 authentication version. Apply it before deploying this release. Existing sessions must sign in again, and unverified accounts must request a replacement verification email. Password recovery now revokes earlier sessions and pending verification links; verification links establish a session only once. The migration clears the resend cooldown for unverified accounts so old links can be replaced immediately. Passwords require at least 12 characters and at most 72 UTF-8 bytes, matching bcrypt's input limit.

Static responses receive browser security headers from `public/_headers`; API responses use `no-store` and `nosniff`. The Email Service binding restricts the sender to `no-reply@idktheflag.sh`; the application pins that address for verification, recovery and invitation mail. The old `EMAIL_FROM` secret may remain for rollback compatibility but is not consumed by this release. Runtime secrets stay in Cloudflare, and `.wrangler` state and local secret variants are ignored. No seeded accounts or passwords are shipped.

Verification requests wait only 60 seconds between successful sends. Failed deliveries return a retryable error without setting a send cooldown; the page distinguishes sending, provider acceptance and failure. Recovery retries retain earlier unexpired recovery links until a reset succeeds. Native Email Service binding acceptance is the authoritative send check; the Wrangler REST send path can fail independently.

Migration `0011_submission_indexes.sql` indexes dashboard ordering and team/user/challenge attempt lookups. A query-plan regression check verifies the dashboard does not build a temporary sort of the entire submission history.
