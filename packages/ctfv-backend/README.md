# idktheCTF Worker

This package serves the frontend assets and Hono JSON API from one Cloudflare Worker. Bindings are defined in `wrangler.toml`: D1 `DATABASE`, private R2 `FILES`, Cloudflare Email Service `EMAIL`, and the secret `OWNER_EMAIL`.

Use the root README for local operation and deployment. Local D1 migrations run with `npx wrangler d1 migrations apply ctfV-db --local` from this directory. Never pass `--remote` during local development.

There is no first-run setup endpoint. The singleton event settings row is created by migration. To bootstrap the organizer, set `OWNER_EMAIL` in `.dev.vars` locally or with `wrangler secret put OWNER_EMAIL` in production; register that email without a username and verify it. No password is seeded. Email verification, invitations, and password recovery use `EMAIL_FROM=no-reply@idktheflag.sh` after the sender is enabled with Cloudflare Email Service.

For local migration rehearsal, pass the same isolated persistence directory to both commands, for example `npx wrangler d1 migrations apply ctfV-db --local --persist-to ./.wrangler/rehearsal` and `npx wrangler dev --persist-to ./.wrangler/rehearsal`. Never run local rehearsal commands with `--remote`.
