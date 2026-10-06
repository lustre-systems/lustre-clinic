# Releasing

One command ships everything: `bun ship`. There are no other release commands.

## Rules for agents

- **Never run `bun ship` or `bun play` yourself**, not even to test them. They build, tag, push and deploy to the clinic. The user runs them in their terminal with `! bun ship`, and the play asks for the sudo password.
- **Tell the user the exact command to run from the table below, and nothing else.** Don't piece together steps like `release.ts`, `build:server`, `pushBinary.ts`, `pushReleases.ts` or `play releases`. `bun ship` already runs them, in the right order.
- **Before a release, the only file to touch is CHANGELOG.md**: lines under `## [Unreleased]`, written for the clinic. Don't move them under a version, add links or date it. `bun ship` does all of that.
- **Never stash, check out or reset to test release scripts.** An older checkout has older scripts, and `bun ship` there is a real release.
- **Don't touch `packages/app/app.json`, `app.config.ts` or `plugins/` unless the change needs a new APK, not even a comment.** They're hashed into the runtime fingerprint byte for byte, so any edit makes `bun ship` refuse the update and ask for `bun ship --apk`.
- If a ship fails, read its last line. It says what to run next: `bun ship` again, or `bun ship deploy`.

## Commands

| The user wants | They run |
|---|---|
| to release what's on `main` (the usual) | `bun ship` |
| a release the phones take right away (download screen, restart) | `bun ship --minor` |
| a patch the phones take right away, without moving to a minor | `bun ship --screen` |
| an update that fresh installs should start on, not take on first launch (rare: rebuilds and sends the APK too) | `bun ship --with-apk` (adds to any of the three above) |
| a new APK: native dependency, `app.json`, config plugin, a baked-in env var | `bun ship --apk` |
| a breaking change the server and app must ship together | `bun ship --apk --major` |
| to see the next number without changing anything | `bun ship --dry-run` |
| to retry only the deploy, after `bun ship` failed at the sudo prompt or the play | `bun ship deploy` |
| a test build on the dev stack (any branch, no changelog, no push) | `bun ship:dev` (`--apk` for a new dev APK, `--screen` or `--minor` to test the download screen) |
| the same, quickly, when only the app changed (copies the new releases, leaves the dev server as it is) | `bun ship:dev:fast` |

If `bun ship` needs an APK (it says "something native changed"), use `bun ship --apk`.

## What `bun ship` does

1. Stops on uncommitted changes, a branch other than `main`, `main` behind origin, a HEAD that's already released, or an empty `[Unreleased]`.
2. Works out the next number from the tags and `dist/releases`.
3. Moves `[Unreleased]` in CHANGELOG.md under that number and commits `docs(changelog): X.Y.Z`.
4. Builds, signs and stages the OTA update in `dist/releases`, then tags `vX.Y.Z`. An update leaves the staged APK as it is; the APK is built only by `--apk`, or `--with-apk` on an update.
5. Pushes `main` and the tag. GitHub makes the release notes and the wiki page from the tag.
6. Builds the server and sends it (`scripts/pushBinary.ts`): nothing if the server already has that binary, otherwise a zstd delta against the one there (a few hundred KB), checked by sha256 before it replaces it.
7. Runs `bun play app --stack=prod` without the releases: builds the image, migrates as the owner, swaps the container and waits for the health check. The old server answers until the swap; the API is down about a second.
8. Sends the releases (`scripts/pushReleases.ts`): one compressed stream of only what the server lacks. Assets the server already has are copied there and the bundle goes as a delta, so a patch is about 1 MB. Files land beside the releases and are renamed in with the pointers last, so a phone never sees half a release. The server always goes first, so phones never get an update ahead of it.

At the end it prints how long each step took and how long the API did not answer. An OTA patch takes a few minutes, most of it the app build.

Running it again after a failure picks up where it stopped. A changelog already cut for the number is kept.

## Patch, minor, APK

- **Patch** (`bun ship`): no screen. Phones download it quietly (every 15 minutes while open, and on each return to the app) and switch to it the next time the app comes back on screen: from WhatsApp, the lock screen, or reopened after a swipe away. Phones on 1.6.2 or older still need two trips of 5+ minutes away, or a cold start (restart the phone).
- **Minor** (`bun ship --minor`): phones on 1.6.0 or later show a download screen and restart into it.
- **Patch with the screen** (`bun ship --screen`): the same download screen and restart, keeping the patch number. Only phones already running a release that knows the flag honour it; older ones take it as a quiet patch.
- **APK** (`bun ship --apk`): phones show an install banner on the home screen and in Settings.

A phone installing fresh gets the staged APK, which is usually older than the latest update: it starts on the APK's own bundle, downloads the latest update on its first launch and switches to it like any other phone (behind the download screen for a minor or `--screen`). `bun ship --with-apk` rebuilds the APK with the update so it starts on it, at the cost of a Gradle build and a 56 MB APK to send. Phones already on the APK's runtime are never offered it.

## Environment

These are read from the root `.env`:

- `LUSTRE_UPDATES_URL`: the prod stack, `http://<clinic>:3000`.
- `LUSTRE_GLITCHTIP_DSN`: required for production builds, same host.
- `LUSTRE_DEV_UPDATES_URL`: the dev stack, `http://<clinic>:3001`, for `bun ship:dev`.
- `LUSTRE_SUDO_PASSWORD_FILE` (optional): a mode-0600 file with the sudo password, so the play doesn't prompt.
- `LUSTRE_SSH` (optional): `user@address` of the clinic server for the transfer scripts. Unset, they take the one clinic in `infra/ansible/inventory.yml`.

The binary delta needs the server's current binary on this machine too. Every binary sent is kept in `~/.cache/lustre/server` (the newest four); the first ship from a machine without it fetches it from the server once, compressed (about 35 s).

Signing keys: [README.md#release-signing](README.md#release-signing). Background on updates and versions: [README.md#releases](README.md#releases).
