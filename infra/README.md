# Clinic server setup

Everything done to a clinic machine beyond the Debian installer lives here, so a
second clinic is a new inventory entry and one command, not a rebuild from
memory.

## Before the playbook

Done by hand, once per machine:

1. Debian 13 netinstall: no desktop, SSH server and standard utilities only.
2. Install Tailscale and log in to the **clinic's** tailnet (not the operator's).
3. In that tailnet's admin console: disable key expiry for the machine, and
   share it to the operator's personal tailnet.
4. From the operator's machine, `ssh-copy-id` a key and confirm a key login
   works over the Tailscale IP.

## Who may reach what

The host firewall accepts anything arriving on `tailscale0`, so the tailnet's
access policy is the only thing separating a phone from the server's SSH port.
Tailscale's default policy separates nothing. `infra/tailscale/policy.hujson`
is the policy this deployment expects: the server carries `tag:clinic-server`,
the doctor's phones get `:3000` and GlitchTip's `:8000` (their crash
reports go there), the operator's phone gets both stacks, and only the
operator's machine gets `:22`.

Every machine is logged in as the same Google account, so the phones are named
by Tailscale IP rather than by user. The server must carry its tag before the
policy is saved, or no rule matches it and the operator loses SSH with
everyone else. All of this is done from the admin console, so it works without
being at the clinic:

1. Add only the policy's `tagOwners` block to the current policy and save. The
   default allow-all rule stays, so nothing changes yet.
2. Machines → the server → Edit ACL tags → `tag:clinic-server`. Tagging from
   the console does not re-authenticate the node, so it stays connected.
   (`tailscale up --advertise-tags` on the server does, and cannot be finished
   remotely.)
3. Fill the phones' addresses in from the Machines page, paste the whole file,
   and save; the built-in tests fail the save if a rule is wrong. Check SSH
   over the tailnet right away. If it fails, revert the policy in the console:
   it lives with Tailscale, not on the server.

## Running it

Needs `ansible-core` 2.15+ on the operator's machine. No collections.

```sh
bun play tailscale base power     # safe, no lockout risk
bun play ssh                      # passwords off
bun play firewall                 # LAN locked down
bun play docker
```

`bun play` runs `ansible-playbook site.yml -K` from `infra/ansible` with the
words as `--tags`; flags pass through (`bun play releases --check`).
`--stack=prod` or `--stack=dev` limits the `app` and `releases` tags to one
stack; without it they act on both, prod first. `-K` asks
for the sudo password each time. To skip that, keep the password in a file
outside the repo with mode 0600 and set `LUSTRE_SUDO_PASSWORD_FILE` to its path.
The first run is split so each risky step can be checked before the next; after
that, `bun play` runs it all and changes nothing on a machine that is already
set up.

In a terminal the play shows one live progress bar and prints only what
changed or failed; `-v`, a piped run, or `ANSIBLE_STDOUT_CALLBACK=default`
gives the stock per-task output (`ansible/callback_plugins/progress.py`).

The SSH and firewall steps end by opening a fresh connection. If either fails,
the session that ran the play has already been closed; get back in over the LAN
(`ssh` to the LAN IP from `lan_cidr`) or at the keyboard.

## Deploying the app

Two stacks run on each clinic machine from the same `compose.yaml`, each in its
own directory with its own database, network and passwords:

| Stack | Directory | API | Database | GlitchTip | Migrations |
|---|---|---|---|---|---|
| prod | `/opt/lustre-prod` | `:3000` | `production`, `127.0.0.1:5432` | `:8000` | a deploy step, as `lustre_owner` |
| dev | `/opt/lustre-dev` | `:3001` | `development`, `127.0.0.1:5433` | none | on boot |

Both listen on the Tailscale address only. Run the `app` tag: `bun play` builds
`dist/lustre` first. A release deploys this way by itself (`bun ship`). The Discord webhook and heartbeat URLs come from the environment so they are
never written into the repo; `read -rs` keeps them out of shell history.

```sh
read -rs LUSTRE_DISCORD_WEBHOOK_URL && export LUSTRE_DISCORD_WEBHOOK_URL
read -rs LUSTRE_HEARTBEAT_URL && export LUSTRE_HEARTBEAT_URL
bun play app                  # both stacks, prod first
bun play app --stack=dev      # the dev stack only; production is not touched
```

For each stack, `app` deploys the server (and migrates prod), then copies
that stack's staged releases, the same work as the `releases` tag. After
`bun play app` there is nothing left for `bun play releases` to do. Because the
server goes first, phones are never offered an update ahead of the server it
needs.

Neither copy is an Ansible `copy`, which checksums file by file and sends
everything uncompressed, at about 145 KB/s upload on the clinic line. The play
runs the same scripts `bun ship` does, from this machine:
`scripts/pushBinary.ts` sends the binary as a zstd delta against the one on the
server (or nothing, when the sha256 already matches) and the migrations, and
`scripts/pushReleases.ts` sends one compressed stream of the releases the
server lacks (see Releases). The image is built before the container is
replaced, so the old server answers through the build and the migration.

Each server reports which stack it is in `health.check` (`environment`), from
the stack's `LUSTRE_ENVIRONMENT`. A server that was never told says
`production`. Dev builds of the app connect only to `development` and refuse
everything else, so a dev phone never reaches the clinic's records.

Each stack's `.env` is generated on the server the first time and never
rewritten: its passwords are the ones the database volume was created with.
Leaving a URL variable unset on a later run keeps the value already there.

Operating a stack from its directory (`COMPOSE_PROJECT_NAME` in `.env` keeps
`docker compose` on the right one):

```sh
cd /opt/lustre-prod
docker compose ps
docker compose logs -f server
docker compose run --rm server backup
```

`lustre seed` refuses the production database, whatever its connection string.

### Phone roles

A phone's role (admin, doctor or secretary) comes from a QR code an admin
shows it; the server reads the role off the credential the phone gets for
scanning it. The first admin, and any admin after every admin phone is lost,
comes from the server itself:

```sh
docker compose run --rm server grant admin "Owner phone"
```

It prints a one-time QR in the terminal, good for 30 minutes. On the phone:
Settings → Scan a role code. From then on the admin issues and withdraws codes
in Settings → Phones & role codes. Phones that have not scanned a code keep
working until the admin turns on "Every phone needs a role code" there. From a
checkout, `bun cli grant admin` does the same against `.env`'s database.

## Google Drive backups

The production stack can push each verified, encrypted dump into a folder in
the doctor's own Google Drive. There are two ways to authorize it. The operator
flow below always works and needs no app. The doctor can also do it from the
phone — Settings → Backups, behind a confirm — once
`BACKUP_DRIVE_ANDROID_CLIENT_ID` names an Android OAuth client; the handset runs
the consent and the server does the token exchange, so no refresh token is ever
held on a phone. Settings also reports: a Backups row, and a card when the grant
needs renewing.

1. Enable the Google Drive API in a Google Cloud project. Configure the consent
   audience (External for personal Gmail, or Internal for an organization-owned
   Workspace project), add only `drive.file`, and create a Desktop OAuth client.
2. On the operator machine, from the repository, run:

   ```sh
   read -r BACKUP_DRIVE_OAUTH_CLIENT_ID && export BACKUP_DRIVE_OAUTH_CLIENT_ID
   read -rs BACKUP_DRIVE_OAUTH_CLIENT_SECRET && export BACKUP_DRIVE_OAUTH_CLIENT_SECRET
   bun drive:authorize
   ```

   The loopback callback listens only on `127.0.0.1`, verifies OAuth state, and
   uses PKCE. Sign in as the doctor. The command creates **Lustre Clinic
   Backups** itself so `drive.file` is sufficient.
3. Securely copy the four printed values into the production stack, together
   with `BACKUP_ENCRYPTION_KEY` (32 bytes, hex or base64 — `.env.example` shows
   how to generate one). The server refuses to upload without the key, and it
   is the only thing that reads a Drive dump back, so keep a copy off the
   clinic machine. For an Ansible deploy, export them before running the `app`
   tag; the generated `/opt/lustre-prod/.env` is mode `0600`, and later deploys
   preserve values already there. Unset the variables and clear the terminal
   afterwards.
4. Restart the server and run `docker compose run --rm server backup`. Confirm
   an encrypted `.dump.enc` file exists in the folder.

### Letting the doctor sign in from the phone

Optional. Without it the app hides the sign-in and `bun drive:authorize` stays
the only way in.

1. In the same Google Cloud project, create a second OAuth client of type
   **Android**. Package name `com.lustre.clinic`; SHA-1 from the certificate the
   APK is signed with. Google issues no secret for this type — PKCE covers it.
2. A debug build and a release build are signed with **different keys**, so they
   have different SHA-1s. Register the release cert for the clinic's real APK,
   and the debug cert too if you want it to work on a development build:

   ```sh
   # release
   keytool -list -v -alias <your alias> -keystore <your release keystore> | grep SHA1
   # debug
   keytool -list -v -alias androiddebugkey -storepass android \
       -keystore packages/app/android/app/debug.keystore | grep SHA1
   ```
3. In the client's **Advanced Settings**, turn on **Enable custom URI scheme**.
   Google leaves it off on new Android clients, and without it the consent page
   stops at "Custom URI scheme is not enabled for your Android client".
4. Put the client id in `BACKUP_DRIVE_ANDROID_CLIENT_ID` on the clinic server and
   restart. Settings → Backups then opens a confirm, and the doctor signs in
   there.

The redirect Google sends the code to is `com.lustre.clinic:/oauth2redirect`
by default, and Google requires that scheme to be the client's package name.
The `Lustre DEV` build is `com.lustre.clinic.dev`, so testing the sign-in on the
dev stack takes a third Android client — package `com.lustre.clinic.dev`, the
debug SHA-1, custom URI scheme enabled — with
`BACKUP_DRIVE_ANDROID_REDIRECT_URI=com.lustre.clinic.dev:/oauth2redirect` set
beside its id on the dev stack. The app registers both schemes.

The handset never holds a refresh token: it returns an authorization code, and
the server exchanges it. A grant made this way is written to
`drive-grant.json` beside the dumps (mode `0600`) and **takes precedence over the
`BACKUP_DRIVE_*` environment values** — it is the more recent statement of which
Drive the clinic uses. Delete that file to fall back to the environment.

This mutation is unauthenticated, like every other procedure (SPEC §1): anyone
who can reach the API on the tailnet can re-point the clinic's off-site backups.
That was accepted deliberately, on the grounds that such a
peer already reads every patient record, and the dumps leave encrypted with a key
that is not on this machine. Leave `BACKUP_DRIVE_ANDROID_CLIENT_ID` empty if you
would rather not take it.

Never put these values in inventory, shell history, or the repository. The
server persists the refresh token, not access tokens. A revoked or expired grant
alerts Discord as `backup.drive_reauthorization_required`, and is recorded in
`offsite-state.json` beside the dumps so `backup.status` can keep reporting it
after the alert has deduped — the doctor's Settings reads that. Repeat the flow
and replace the refresh token; the next successful upload clears the state by
itself. Supply the existing `BACKUP_DRIVE_FOLDER_ID` to the
flow so reauthorization keeps the same folder. External apps left in Google's
Testing state receive seven-day grants, so a personal-account deployment must
use In production. `drive.file` is non-sensitive; a one-clinic personal-use app
can be unverified, while a Workspace administrator may use an Internal app or
trust the client according to organization policy.

The legacy service-account variables are preserved only for Workspace shared
drives or domain-wide delegation. They cannot write into personal My Drive and
are ignored when any OAuth credential field is present. OAuth configuration
must then be complete.

## Releases

The phones get new code two ways (SPEC §15), both from the clinic server over
Tailscale, with nothing hosted anywhere else:

- **A JavaScript update (OTA)** covers any change that is only JavaScript. A
  release build asks the server on every launch and downloads in the
  background. It never waits on the network at launch, so a power cut starts the
  app on the last bundle it had. What happens next depends on the number:
  - a **patch** runs when the app is brought back after being away 5 minutes
    or more (from 1.6.1), or on a cold start, and never reloads mid-screen.
    Coming back after 5 minutes also checks for new updates: Android keeps the
    app alive for days, and expo-updates otherwise only checks on a cold start;
  - a **minor** covers the screen with its download progress and restarts into
    the update as soon as it lands (`packages/app/src/shell/UpdateScreen.tsx`,
    rule in `updateGate.ts`). Only phones already running 1.6.0 or later have
    that screen.
- **A new APK** is needed for anything native: a new native dependency, an
  `app.json` change, a config plugin change, or a change to a value baked into
  the build (`LUSTRE_UPDATES_URL`, `LUSTRE_DEV_UPDATES_URL`,
  `LUSTRE_GLITCHTIP_DSN`). The home screen and Settings show a banner when the
  server has a higher build than the phone; tapping it downloads the APK in the
  browser and Android's installer takes over.

Production releases are staged in `dist/releases`; development releases are staged
in `dist/releases-dev`. `scripts/pushReleases.ts --stack=prod|dev` copies each
directory to its matching stack; `bun ship` runs it once the server is up, and
the `releases` tag (and the `app` tag, which includes it) runs it for both
stacks unless `--stack` says which. The server reads releases on each request;
nothing restarts.

The copy is one SSH session and one zstd tar stream of only what the server
lacks. An update's assets are named by their content, so the ones an earlier
update already has are copied on the server, and the JavaScript bundle goes as
a delta against the previous one: a patch is about 1 MB instead of 14. The
stream lands in `/opt/lustre-<stack>/.releases-incoming`, every file the server
rebuilt is checked against its sha256, and only then is each file renamed into
place, the pointers (`updates/<runtime>/latest.json`, then `android/lustre.apk`,
then `android/latest.json`) last. Nothing is deleted, so a phone mid-download
keeps its file.

### Versions

Every release is `MAJOR.MINOR.PATCH`, and the release scripts pick the number;
nothing is bumped by hand.

| Part | Means | Set by |
|---|---|---|
| MAJOR | a change the server and the app must ship together | `bun ship --apk --major` |
| MINOR | a new APK, or an OTA update the phones stop and take now; PATCH goes back to 0 | `bun ship --apk`, `bun ship --minor` |
| PATCH | a quiet OTA update on that APK's runtime: 1.4.1, 1.4.2, … | `bun ship` |

The next number is one above the higher of the `vX.Y.Z` git tags and what is
already staged in `dist/releases`, so a lost tag or a wiped staging directory
cannot make a number repeat (`packages/app/scripts/releaseVersion.ts`). An
update counts on from everything released since the staged APK, so the patch
after an OTA 1.6.0 is 1.6.1. It needs a staged APK with its runtime version and
is refused without one, because no phone would take it.

An update leaves the staged APK as it is, so a phone installing fresh starts on
an older bundle (the APK's 1.4.0) and takes the latest update on its first
launch. `bun ship --with-apk` also rebuilds the APK from the same commit,
numbered as the update (1.4.1), and stages it over the last one, so a fresh
install starts on it; that costs a Gradle build and a 56 MB upload. Either way
the APK has the same runtime, so phones already running it are not offered it:
the update brought them the same code. Only an APK with new native code shows
the install banner.

`bun ship` refuses uncommitted changes, tags the commit it built from and
pushes the tag.

Settings → App shows the release the phone runs (the update's number, `1.4.2`)
with the APK under it (`1.4.0 · build …`, or a later patch if it was rebuilt
with `--with-apk`). GlitchTip files crashes under the same
number, `lustre@1.4.2`.

The runtime version is a fingerprint of native code only.
`packages/app/fingerprint.config.js` keeps the version number out of it, or
every release would get a runtime of its own and no update would reach a phone.

### Release signing

Two keys, both on the operator's machine only, never in the repo and never on
the clinic server:

| What | File | Gradle property |
|---|---|---|
| APK keystore (PKCS12, alias `lustre-clinic`) | `~/.local/share/lustre/signing/lustre-clinic-release.jks` | `LUSTRE_RELEASE_STORE_FILE`, `LUSTRE_RELEASE_KEY_ALIAS`, `LUSTRE_RELEASE_STORE_PASSWORD`, `LUSTRE_RELEASE_KEY_PASSWORD` |
| OTA update signing key (RSA) | `~/.local/share/lustre/signing/updates/private-key.pem` | `LUSTRE_UPDATES_PRIVATE_KEY` |

The paths and passwords live in `~/.gradle/gradle.properties` (or the same names
in the environment). The keystore's SHA-256 certificate fingerprint is
`A1:FE:DF:AA:3E:BC:51:7C:82:9C:68:0A:41:41:96:69:07:9B:F6:D5:B6:A3:40:33:4E:FC:8D:FE:57:24:5E:CC`.
The update key's public certificate is committed at
`packages/app/certs/certificate.pem`.

**Back up both files and the passwords**: a password manager, plus one off-site
copy. Losing the keystore means every phone has to uninstall before it can take
another APK, and an uninstall wipes the saved server address, the role and the
cached schedule. Losing the update key means no more OTA updates until a new
APK carrying a new certificate is installed on every phone.

On another build machine, copy both files and add the properties, with absolute
paths:

```properties
LUSTRE_RELEASE_STORE_FILE=/home/<you>/.local/share/lustre/signing/lustre-clinic-release.jks
LUSTRE_RELEASE_KEY_ALIAS=lustre-clinic
LUSTRE_RELEASE_STORE_PASSWORD=<from the password manager>
LUSTRE_RELEASE_KEY_PASSWORD=<same as the store password>
LUSTRE_UPDATES_PRIVATE_KEY=/home/<you>/.local/share/lustre/signing/updates/private-key.pem
```

A release build without them fails and names what is missing. It never falls
back to the debug key. Debug builds do not need them.

### Shipping

Every release goes out with `bun ship` ([RELEASING.md](RELEASING.md) has the
commands and what each step does). What it needs:

`LUSTRE_UPDATES_URL` and `LUSTRE_GLITCHTIP_DSN` are read from the root `.env`
(`.env.example` documents them). `LUSTRE_UPDATES_URL` is the prod stack's
address, the one `health.check` reports. It is baked into the APK as the place
to ask for OTA updates, so use the same value every time. The build is arm64
only; `LUSTRE_APK_ABIS=arm64-v8a,x86_64` adds the emulator's ABI. Every release
build gets a higher `versionCode` (tens of seconds since 2026-01-01 UTC, see
`plugins/withReleaseVersionCode.js`), and a build that is not higher than the
one already staged, or signed with any certificate but the release keystore's,
is refused.

`LUSTRE_GLITCHTIP_DSN` is the crash reporting DSN (SPEC §17), from the GlitchTip
UI under the project's Settings -> Client Keys. Use the clinic's MagicDNS name,
not localhost: the DSN is read on the phone, so loopback would name the phone.
It is baked into the APK at build time and no OTA update can add it later, so a
production build without it is refused. It must name the same host as
`LUSTRE_UPDATES_URL`. Updates need the same value too: the DSN is part of the
runtime fingerprint, so an update published without it would target a runtime
no phone has. Dev and demo builds are exempt and ship with reporting off on
purpose.

An update is only offered to APKs with the same runtime version, a fingerprint
of everything native. `bun ship` refuses when the staged APK's runtime differs:
something native changed, and it needs `bun ship --apk` instead.

Check the server has the APK: `curl http://<clinic>:3000/trpc/release.latestApk`.

**Once per phone, at handover**: allow the browser to install apps (Android
Settings → Apps → Chrome → Install unknown apps). The first install is over the
cable with `adb install`; after that, Settings → Download, then Install. The
role and saved address survive because the APK is signed with the same key.

### After an update ships

A patch never shows a screen. The phone downloads it on launch, every 15
minutes while the app is open, and on each return to the app. It switches to
it the next time the app comes back on screen, from WhatsApp, the lock screen or
a reopen after a swipe away, and also when one finishes downloading within 10
seconds of that return or of a cold start (`packages/app/src/shell/updateGate.ts`). Google's
sign-in and the notification permission dialog hold it off, since they leave the
app and need it unchanged when they come back. Swiping the app away does not
end it (the listener service keeps the process), so the app notices the reopen
itself. Phones on 1.6.2 or older only check after 5 minutes away and switch on
the next such return: two trips, or a cold start (restarting the phone). A
minor shows the download screen and restarts by itself. Settings → App →
Version shows the new number, and Update shows the update's short id.

- **An update that crashes before its first screen draws** rolls itself back:
  expo-updates marks it failed and relaunches on the previous bundle. That
  relaunch can come up blank; closing and reopening the app clears it. A crash
  after the first screen has drawn, such as one behind a button, is not caught
  and does not roll back: fix forward by publishing a corrected update.
- **An update with a bug that does not crash**: check out the last good
  release (`git revert` the bad commits on `main`) and `bun ship` again. It is
  published as the next number, `1.4.3`, and becomes the latest.
- **Which update a crash came from**: GlitchTip's release is the number the
  phone ran, `lustre@1.4.2`. Every report also carries an `update` tag (the id,
  or `embedded` for the APK's own bundle) and a `runtime` tag.
- The `bun app` development build loads Metro and does not take OTA updates.
  The installable development build below takes signed updates from the dev
  stack. Demo builds have updates switched off.

### Development build with OTA

The phone can hold `Lustre Clinic` (`com.lustre.clinic`) and `Lustre DEV`
(`com.lustre.clinic.dev`) together. The OTA development build replaces the
existing Metro development install under `.dev`; its app data is separate from
production. It uses the same debug signing key as the Metro build. The first
OTA development launch starts with the dev stack at port 3001, even if the
Metro build had a different server saved. The red DEV strip remains visible.

```sh
bun ship:dev --apk
adb -s <phone serial> install -r dist/releases-dev/android/lustre.apk
```

The dev track reads `LUSTRE_DEV_UPDATES_URL` (the dev stack,
`http://<clinic>:3001`) from `.env` and uses it in place of
`LUSTRE_UPDATES_URL`. It is baked in as both the OTA source and the server the
build opens on. The script refuses to build without it, or with the clinic's
own address. Changing it changes the runtime, so it needs a new dev APK. A dev
build also refuses to connect to any server that does not report
`environment: development` (see Deploying the app).

The dev stack serves only the `development` update channel; production serves
only `production`. Both check on launch and download in the background, and
follow the same patch and minor rules. The development APK and its OTA updates are
signed, and only a matching native runtime accepts an update. To publish one:

```sh
bun ship:dev
```

`bun ship:dev` is `bun ship` on the dev track, deployed to the dev stack. It
cuts no changelog, pushes nothing and ships any branch.

Development versions use `dev-vX.Y.Z` git tags, separate from production's
`vX.Y.Z`, and they stay local. A native change needs `bun ship:dev --apk` again. Running `bun app` later reinstalls the Metro build
over `.dev`; reinstall the staged development APK to resume OTA testing.

The manifest is signed on this machine when it is published; the server only
serves the signed bytes. To see what a phone would get:

```sh
curl -i http://<clinic>:3000/updates/manifest \
  -H 'expo-protocol-version: 1' -H 'expo-platform: android' \
  -H 'expo-channel-name: production' -H 'expo-runtime-version: <runtime>'
```

A `204` means nothing is published for that runtime.

## Optional backup copies on the operator's machine

In addition to Google Drive, the operator machine can pull another encrypted
copy over Tailscale. The server still restore-verifies and prunes its own dumps
(SPEC §16).

```sh
sudo pacman -S age
infra/operator/install.sh smilemakers
```

`install.sh` asks for the backup public key, or creates a new key and prints the
private half once. That goes in a password manager and on paper; this machine
keeps only the public half, which can encrypt but not decrypt.

It then enables `lustre-backup-pull@<clinic>.timer`, which runs hourly (and at
login if a run was missed): copies new dumps, encrypting each as it arrives and
checking it against the server's checksum, keeps 14 daily and 12 monthly, and
alerts Discord if nothing newer than 72 hours has arrived. Logs:
`journalctl --user -u 'lustre-*'`.

No restore check runs here: the server restores every dump before it can be
pulled. It writes each dump as `lustre-<stamp>.dump.<id>.partial` and renames
it to `lustre-<stamp>.dump` only after the restore check passes and the file is
on disk, and the pull only copies the final name. A run cut short leaves just
the `.partial` file, which the server deletes the next time it starts. To
restore from a copy here:

```sh
age -d -i key.txt lustre-<stamp>.dump.age > lustre.dump
```

## Scripts

Every script in the root `package.json`, run from the repo root. Scripts that
talk to the clinic server say which stack they touch.

**Server and checks**

| Script | Does |
|---|---|
| `bun dev` | The API from source with `--watch`, reading the root `.env`. Reports `environment: development`. |
| `bun server` | The same, without `--watch`. |
| `bun start` | `bun dev` in the background plus `bun emu` in front (`scripts/dev.sh`). Ctrl-C stops both; arguments go to the emulator script (`bun start --clear`). |
| `bun run build:server` | Compiles `dist/lustre` and copies the migrations to `dist/migrations`. `bun play` runs it before deploying the app. |
| `bun lint` / `bun lint:fix` | Biome check, or check and fix. |
| `bun format` | Biome format, writing. |
| `bun typecheck` | `tsc --noEmit` in every package. |
| `bun test` | Every test suite. The server's needs the test database (root README). |
| `bun fallow` | Dead code, duplication and complexity report. Never clean; read what it says about the files you touched. |

**Database and backups** (against whatever database the root `.env` names)

| Script | Does |
|---|---|
| `bun db:generate` | Writes a migration from schema changes (drizzle-kit). |
| `bun db:migrate` | Applies pending migrations. |
| `bun db:seed` | Replaces every row with the development seed. Destructive; refuses a production database, and a non-local one without `--force`. |
| `bun db:repair-refs` | Reports migrated patients whose paper-file number was lost; `--apply` writes the fix. |
| `bun backup` | Dump, verify by restoring, prune (root README, Backups). |
| `bun restore <file> [--key <base64>]` | Restores a dump into a scratch database, checks it and drops it. |
| `bun drive:authorize` | The one-time Google Drive sign-in; prints the refresh token (Google Drive backups, above). |

**Running the app locally** (dev builds, `com.lustre.clinic.dev`, against your `bun dev`)

| Script | Does |
|---|---|
| `bun app` | USB phone: builds if needed, installs, launches, starts Metro (`packages/app/scripts/device.sh`). |
| `bun app:build` | The same, forcing a native rebuild. |
| `bun app:release` | Builds and installs a release-mode APK on the USB phone, no Metro. The only honest way to judge speed. |
| `bun app:stop` | Stops the Gradle daemon. |
| `bun app:go` | `expo start` for Expo Go. |
| `bun emu` / `emu:build` / `emu:start` | The same as `bun app`, on the Android emulator (`emulator.sh`): run, force a rebuild, Metro only. |
| `bun emu:shot <file.png>` | Screenshots the emulator. |
| `bun waydroid` / `waydroid:build` / `waydroid:start` / `waydroid:stop` | The same on Waydroid (`waydroid.sh`), which agents use; `:stop` frees its memory. |
| `bun waydroid:shot <file.png>` | Screenshots Waydroid. |

`packages/app` also has `device:start` (Metro only for the USB phone),
`device:logs` (the phone's JS log), `emu:release` and `waydroid:release`. Run
those with `bun run --cwd packages/app <name>`.

**Releasing and deploying** ([RELEASING.md](RELEASING.md) says which to run)

| Script | Does |
|---|---|
| `bun ship [--minor \| --apk [--major]]` | The whole release: changelog, build, tag, push, then `play app` on prod |
| `bun ship deploy` | Only the deploy, for the release at HEAD |
| `bun ship:dev [--apk]` | The same on the dev track and dev stack. No changelog, no push |
| `bun play [tags] [--stack=prod\|dev]` | The ansible play (Running it, above). Builds the server first when it deploys `app`. `app` and `releases` act on both stacks unless `--stack` is given |

## Adding a clinic

Add a host under `clinics` in `ansible/inventory.yml` with its Tailscale IP and
the clinic's LAN range, then run the playbook with `--limit <host>`.

## What it sets up

| Tag | Result |
|---|---|
| `tailscale` | Asserts the node is logged in, prints tailnet, IPs, MagicDNS name and key expiry. Turns off Tailscale DNS so it stops fighting dhcpcd, and Tailscale SSH so tailnet logins go through sshd's key-only rules instead of bypassing them. |
| `base` | Timezone, unattended security upgrades, never suspends (lid shut, sleep targets masked), boots to text mode. |
| `power` | Survives power cuts unattended: boot-time fsck repairs without asking, upower starts on text-mode boots and powers the machine off cleanly at 35% on a long cut (the first laptop's worn battery reads 35% and then 3% a minute later), and Tailscale and SSH start on boot. `lustre-power-alert` tells Discord when mains is lost, when the battery reaches 40%, and when mains or the machine comes back; alerts wait on disk while the network is down with the power, and it uses the prod stack's webhook (`journalctl -u lustre-power-alert`). |
| `network` | Wired ports follow the cable (systemd-networkd, preferred over Wi-Fi, no boot wait without one); Wi-Fi stays as the fallback. The host uses fixed DNS servers instead of whatever DHCP last wrote. |
| `ssh` | Key-only, no root, only the admin user. |
| `firewall` | nftables, own table only. Inbound: everything over `tailscale0`, SSH from the LAN, Tailscale's direct-connection port. Nothing else. The allow-list is enforced in prerouting as well as input, because Docker's published ports bypass input: a container published on `0.0.0.0` or the LAN IP is still unreachable from the LAN. |
| `docker` | Docker CE and the compose plugin from Docker's apt repo, log rotation, admin user in the `docker` group, and no port-bind race with Tailscale at boot. |
