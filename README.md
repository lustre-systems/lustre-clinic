<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/app/assets/brand/lustre-clinics-reverse.svg">
    <img src="packages/app/assets/brand/lustre-clinics-colour.svg" alt="Lustre Clinics" width="320">
  </picture>
</p>

<p align="center">
  The appointment book, patient records and takings for a dental practice.<br>
  Each clinic runs it on a computer it owns, reached over its own private network.
</p>

<p align="center">
  <a href="https://github.com/lustre-systems/lustre-clinic/actions/workflows/ci.yml"><img src="https://github.com/lustre-systems/lustre-clinic/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/github/v/tag/lustre-systems/lustre-clinic?filter=v*&label=release&color=14110F" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-source--available-55504A" alt="License: source-available"></a>
  <br>
  <img src="https://img.shields.io/badge/Android-Expo_57-14110F?logo=expo&logoColor=white" alt="Android, Expo 57">
  <img src="https://img.shields.io/badge/React_Native-0.86-14110F?logo=react&logoColor=61DAFB" alt="React Native 0.86">
  <img src="https://img.shields.io/badge/Bun-tRPC_11-14110F?logo=bun&logoColor=white" alt="Bun and tRPC 11">
  <img src="https://img.shields.io/badge/PostgreSQL-17-14110F?logo=postgresql&logoColor=white" alt="PostgreSQL 17">
  <img src="https://img.shields.io/badge/network-Tailscale_only-14110F?logo=tailscale&logoColor=white" alt="Tailscale only">
</p>

<p align="center">
  <a href="https://github.com/lustre-systems/lustre-clinic/wiki">Wiki</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="PRODUCT.md">Product</a> ·
  <a href="infra/README.md">Server setup</a> ·
  <a href="infra/RELEASING.md">Releasing</a>
</p>

<p align="center">
  <img src=".github/assets/screenshots/day.png" alt="The day: at the desk, in the chair, waiting, next" width="200">
  <img src=".github/assets/screenshots/record.png" alt="A patient's visits and balance" width="200">
  <img src=".github/assets/screenshots/money.png" alt="Charged, collected and due for the month" width="200">
  <img src=".github/assets/screenshots/patients.png" alt="The patient register" width="200">
</p>

---

# Lustre

Clinic management app for a dental practice. React Native client, on-prem server,
Tailscale-only network.

It replaces a paper appointment book and an unwatched WhatsApp number without
adding steps to the day, so fewer bookings, reminders and payments get missed.

- **No cloud.** Each clinic's server and database run on a computer at that
  clinic, reachable only over its tailnet. The only copy that leaves is an
  encrypted nightly backup in the doctor's own Google Drive. All clinic-specific
  values are data, so another clinic runs the same build.
- **No automated messaging.** The app never sends anything. It prepares the
  WhatsApp message and the secretary sends it from her own phone.
- **Overlap is impossible by construction.** A Postgres `EXCLUDE USING gist`
  constraint refuses double-bookings, not application code.

The PRD (what it does and why) and the technical spec (how it is built) live on
[Notion](https://app.notion.com/p/3b7541c6b44181d8a6aee73ec9b34dcc).

## Layout

```
packages/
├── shared/   # ERROR_CODE, domain enums, constants — the hand-written contract
├── server/   # Bun + tRPC + Postgres 17 (Drizzle over postgres.js)
└── app/      # React Native (Expo)
```

Request and response types are not hand-written. They flow from the inferred
`AppRouter` type, which `packages/app` imports from `packages/server`.

## Running it

```sh
bun install

cp .env.example .env          # set POSTGRES_PASSWORD
docker compose up -d db       # Postgres 17

bun db:migrate                # apply migrations
bun dev                       # server on :3000
```

Then, in `packages/app`:

```sh
bun start
```

Open it in Expo Go by scanning the QR code it prints. When 8081 is already
taken — another worktree's bundler — run `bun start --port 8082`. Expo Go only
finds a server on 8081 by itself, so scan the QR code or use *Enter URL
manually* with `exp://<this machine's IP>:8082`.

`bun app` from the root is the other route: a development build on a USB
phone (`packages/app/scripts/device.sh`), for anything native.

## Checks

```sh
bun lint
bun typecheck
bun test
bun format
```

All four must pass before a task is considered complete. CI runs lint,
typecheck and test on every push (`.github/workflows/ci.yml`). `bun fallow`
reports dead code and duplication; it never passes clean, so read what it says
about the files you touched.

Every script, and what it touches: [infra/README.md#scripts](infra/README.md#scripts).

### The test database

The suite runs against a real Postgres — the rules worth testing are the ones
Postgres enforces — and it **truncates every table between tests**. It therefore
runs against its own database, never the one `.env` points at. Create it once:

```sh
docker compose exec db createdb -U lustre lustre_test
```

`bun test` loads `packages/server/.env.test` through a preload
(`bunfig.toml`), so the safe database is the default however the runner is
invoked. `assertTestDatabase` in `packages/server/tests/helpers/db.ts` is the
backstop: it refuses to start against any database whose name does not end in
`_test`.

The backup suite shells out to `pg_dump` and `pg_restore`. Without them on PATH
the restore test — the only proof a dump is usable — skips locally, and fails
outright in CI rather than skipping silently.

## Backups

```sh
bun backup                              # dump, verify by restoring, prune
bun restore backups/lustre-....dump      # restore into a scratch db and drop it
bun restore backups/lustre-....dump.enc --key <base64>
```

`pg_dump` and `pg_restore` must be on PATH and must be version 17. The server
image installs them (see `Dockerfile`); on a dev machine install your
distribution's `postgresql-client`, or set `PG_BIN_DIR`. Without them the backup
job fails loudly and its tests skip.

Every run is verified by restoring the dump into a scratch database and
comparing row counts — an unverified dump is not a backup (SPEC §16). Off-site
upload is encrypted with `BACKUP_ENCRYPTION_KEY` and is skipped when no
destination is configured.

### Off-site copies (Google Drive)

The normal destination is a folder created in the doctor's own Drive through a
one-time OAuth sign-in. It works with personal Gmail and Google Workspace and
uses only `drive.file`, so Lustre cannot browse unrelated Drive files.

1. In a Google Cloud project, enable the Drive API, configure the OAuth consent
   screen, and create a **Desktop app** OAuth client.
2. On the operator's machine, set `BACKUP_DRIVE_OAUTH_CLIENT_ID` and
   `BACKUP_DRIVE_OAUTH_CLIENT_SECRET`, then run `bun drive:authorize`. Open the
   printed URL, sign in as the doctor, and accept the one requested scope. Set
   `BACKUP_DRIVE_LOGIN_HINT` first if account selection could be ambiguous.
3. Copy the four printed `BACKUP_DRIVE_*` lines into the clinic server's private
   stack environment (`/opt/lustre-prod/.env`, mode `0600`). Clear the terminal
   after copying them and restart the server.
4. Set `BACKUP_ENCRYPTION_KEY`, or off-site upload is refused. Run
   `docker compose run --rm server backup` once and confirm the encrypted file
   appears in the new **Lustre Clinic Backups** folder.

For personal Gmail, use an External audience and move the consent app to **In
production**: Testing grants expire after seven days. A one-clinic personal-use
app using the non-sensitive `drive.file` scope can remain unverified, although
Google may show an unverified-app warning. For Workspace, an organization-owned
project may use an Internal audience; an administrator can still restrict the
app.

The refresh token is stored only in the clinic's private environment file.
Short-lived access tokens are cached in memory and never written to disk. If
Google returns `invalid_grant` after revocation or expiry, Discord receives
`backup.drive_reauthorization_required` and the doctor's Settings shows that
Drive needs a new sign-in — the dump itself keeps succeeding, so nothing else
looks wrong. Rerun `bun drive:authorize`, replace the refresh token it prints,
and restart the server; the next upload clears the warning. Set the existing
`BACKUP_DRIVE_FOLDER_ID` while rerunning so the flow keeps using the same folder.

The old service-account fields remain as a Workspace-only compatibility path.
They still require a shared drive or domain-wide delegation via
`BACKUP_DRIVE_SUBJECT`; they do not work with personal My Drive. If any OAuth
field is present, OAuth must be complete and takes precedence rather than
silently falling back to the service account.

Retention applies off-site exactly as it does locally: same 14/8/12 policy,
and a file whose name does not parse as a dump is never touched.

## Deployment

The clinic machine runs two stacks, prod on `:3000` and dev on `:3001`,
deployed with `bun play app` (`--stack=dev` for dev only). Releases go out with
`bun ship`. See [infra/README.md](infra/README.md) and
[infra/RELEASING.md](infra/RELEASING.md). Under the play, it is
`docker compose up -d` per stack.
The published port binds to the Tailscale interface only — there is no public
ingress, no TLS termination, and no authentication. Reachability on the tailnet
is the authorization model (SPEC §1).
