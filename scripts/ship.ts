/**
 * The whole release, from `main` to the clinic (infra/RELEASING.md).
 *
 *   bun ship [--minor]          an OTA update: a quiet patch, or a minor the phones take now
 *   bun ship --screen           a patch the phones take now, behind the download screen
 *   bun ship --with-apk         an update that also rebuilds the APK, so fresh installs start on it
 *   bun ship --apk [--major]    a new APK, for a native change
 *   bun ship --dry-run          prints the number and changes nothing
 *   bun ship deploy             the deploy step alone, for the release at HEAD
 *   bun ship:dev [--apk|--screen]  the dev track, to the dev stack
 *   bun ship:dev --fast         the same, but copies only the releases (scripts/pushReleases.ts)
 *                               [--keep-server] when a server change since the last dev tag doesn't matter
 *
 * In order: checks `main` is clean and not behind origin, asks `release.ts` for
 * the number, moves `[Unreleased]` in CHANGELOG.md under it and commits, builds
 * and stages the release (which tags it), pushes `main` and the tag, builds the
 * server and sends it (`pushBinary.ts`, a delta), runs `play app` to restart
 * it, and last sends the releases (`pushReleases.ts`), so no phone is offered
 * an update ahead of the server it needs. It prints how long each step took,
 * and how long the API did not answer while the server restarted.
 *
 * Run it again after a failure: a changelog already cut for the number is kept,
 * and every message says what to run next. The dev track cuts no changelog and
 * pushes nothing: its `dev-v*` tags stay here. It also ships the same commit
 * again, since testing an update on a phone takes several in a row.
 */
import { join, resolve } from 'node:path';
import { $ } from 'bun';
import { healthUrl, sshHost, watchHealth } from './clinicServer';
import { cutChangelog } from './cutChangelog';

const ROOT = resolve(import.meta.dir, '..');
const RELEASE = join(ROOT, 'packages/app/scripts/release.ts');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
/** What `build:server` compiles. The deploy builds from the working tree, so these must match the tag. */
const SERVER_PATHS = ['packages/server', 'packages/shared', 'bun.lock', 'package.json'];

/** What `printTimings` reports. Declared before anything can `fail`, which prints them. */
const shipStarted = performance.now();
const phases: { name: string; seconds: number; note?: string }[] = [];
let current: { name: string; started: number } | null = null;

const args = process.argv.slice(2);
const deployOnly = args[0] === 'deploy';
const dev = args.includes('--dev');
const apk = args.includes('--apk');
const dryRun = args.includes('--dry-run');
const fast = args.includes('--fast');
const keepServer = args.includes('--keep-server');
const withApk = args.includes('--with-apk');
const known = [
    'deploy',
    '--dev',
    '--apk',
    '--major',
    '--minor',
    '--screen',
    '--dry-run',
    '--fast',
    '--keep-server',
    '--with-apk',
];
const unknown = args.filter((arg) => !known.includes(arg));
if (unknown.length) fail(`unknown ${unknown.join(' ')}. See the top of scripts/ship.ts.`);
if (args.includes('--major') && !apk) fail('--major is for an APK: bun ship --apk --major');
if (args.includes('--minor') && apk) fail('--minor is for an update. An APK is always at least a minor.');
if (keepServer && !fast) fail('--keep-server goes with --fast: bun ship:dev:fast --keep-server');
if (fast && !args.includes('--dev')) fail('--fast is for the dev track: bun ship:dev --fast');
if (args.includes('--screen') && apk) fail('--screen is for an update. An APK shows its own install banner.');
if (withApk && apk) fail('--with-apk is for an update. --apk builds the APK anyway.');

const stack = dev ? 'dev' : 'prod';
const tagPrefix = dev ? 'dev-v' : 'v';
const trackEnv = { ...process.env, LUSTRE_RELEASE_TRACK: dev ? 'development' : 'production' };

function say(line: string): void {
    process.stdout.write(`\n» ${line}\n`);
}

function fail(line: string): never {
    printTimings();
    process.stderr.write(`ship: ${line}\n`);
    process.exit(1);
}

async function timed<T>(name: string, task: () => Promise<T>): Promise<T> {
    const started = performance.now();
    current = { name, started };
    try {
        return await task();
    } finally {
        phases.push({ name, seconds: (performance.now() - started) / 1000 });
        current = null;
    }
}

function duration(seconds: number): string {
    if (seconds < 60) return `${seconds.toFixed(1)} s`;
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** How long each step took, and the whole run. Also printed when a step fails. */
function printTimings(): void {
    const rows = [...phases];
    if (current)
        rows.push({
            name: `${current.name} (failed)`,
            seconds: (performance.now() - current.started) / 1000,
        });
    if (!rows.length) return;
    rows.push({ name: 'total', seconds: (performance.now() - shipStarted) / 1000 });
    const width = Math.max(...rows.map((row) => row.name.length)) + 2;
    const lines = rows.map(
        (row) =>
            `  ${row.name.padEnd(width)}${duration(row.seconds).padStart(7)}${row.note ? `  ${row.note}` : ''}`,
    );
    process.stdout.write(`\n» Timings\n${lines.join('\n')}\n`);
}

async function git(...parts: string[]): Promise<string> {
    const result = await $`git ${parts}`.cwd(ROOT).quiet().nothrow();
    if (result.exitCode !== 0) fail(`git ${parts.join(' ')}: ${result.stderr.toString().trim()}`);
    return result.stdout.toString().trim();
}

async function gitSucceeds(...parts: string[]): Promise<boolean> {
    return (await $`git ${parts}`.cwd(ROOT).quiet().nothrow()).exitCode === 0;
}

/** Runs on this terminal, so the build's progress and the sudo prompt reach the person shipping. */
async function run(
    command: string[],
    env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
    const child = Bun.spawn(command, { cwd: ROOT, env, stdio: ['inherit', 'inherit', 'inherit'] });
    return (await child.exited) === 0;
}

/** The newest release tag at or before `ref`, or null. */
async function releaseTagAt(ref: string): Promise<string | null> {
    const result = await $`git describe --tags --abbrev=0 --match ${`${tagPrefix}[0-9]*`} ${ref}`
        .cwd(ROOT)
        .quiet()
        .nothrow();
    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

async function nextVersion(): Promise<string> {
    const flags = args.filter((arg) => arg === '--major' || arg === '--minor');
    const result = await $`bun ${RELEASE} next ${apk ? 'apk' : 'update'} ${flags}`
        .cwd(ROOT)
        .env(trackEnv)
        .quiet()
        .nothrow();
    if (result.exitCode !== 0) {
        process.stderr.write(result.stderr);
        fail('could not work out the next number. Nothing was changed.');
    }
    return result.stdout.toString().trim().split('\n').at(-1) ?? '';
}

async function preflight(): Promise<void> {
    if (await git('status', '--porcelain')) {
        fail('the working tree has uncommitted changes. Commit or stash them first.');
    }
    if (fast) {
        const last = await releaseTagAt('HEAD');
        if (!last) fail('--fast needs a dev release on the server already. Run `bun ship:dev` once.');
        if (!keepServer && (await serverChangedSince(last))) {
            fail(
                `the server code changed since ${last}, and --fast never deploys it. Run \`bun ship:dev\`, or add --keep-server if the server doesn't need it.`,
            );
        }
    }
    if (dev) return;

    const released = await git('tag', '--points-at', 'HEAD', '--list', `${tagPrefix}[0-9]*`);
    if (released) {
        fail(
            `HEAD is already released as ${released.split('\n')[0]}. Nothing new to ship. If it never reached the server, run \`bun ship deploy${dev ? ' --dev' : ''}\`.`,
        );
    }

    if ((await git('branch', '--show-current')) !== 'main')
        fail('ship from main. The dev track (--dev) ships any branch.');
    await git('fetch', '--quiet', 'origin', 'main');
    if (!(await gitSucceeds('merge-base', '--is-ancestor', 'origin/main', 'HEAD'))) {
        fail('main is behind origin/main. Pull first, so the release has everything already merged.');
    }
}

/** A new root `scripts` entry changes no server, so --fast looks past it. */
async function serverChangedSince(tag: string): Promise<boolean> {
    const paths = SERVER_PATHS.filter((path) => path !== 'package.json');
    if (!(await gitSucceeds('diff', '--quiet', tag, 'HEAD', '--', ...paths))) return true;
    const manifest = async (ref: string) => {
        const { scripts: _, ...rest } = JSON.parse(await git('show', `${ref}:package.json`));
        return JSON.stringify(rest);
    };
    return (await manifest(tag)) !== (await manifest('HEAD'));
}

/** Opens the release in CHANGELOG.md and commits it, so the tag carries its notes. */
async function cutRelease(version: string): Promise<void> {
    const today = new Date().toLocaleDateString('en-CA');
    let cut: string | null;
    try {
        cut = cutChangelog(await Bun.file(CHANGELOG).text(), version, today);
    } catch (error) {
        fail((error as Error).message);
    }
    if (!cut) {
        say(`CHANGELOG.md already has ${version}. Keeping it.`);
        return;
    }
    if (dryRun) {
        say(`Would move [Unreleased] under ${version} in CHANGELOG.md and commit it.`);
        return;
    }
    await Bun.write(CHANGELOG, cut);
    await git('commit', '--quiet', '--message', `docs(changelog): ${version}`, '--', 'CHANGELOG.md');
    say(`Moved [Unreleased] under ${version} and committed it.`);
}

/**
 * Builds the server, sends it, restarts it (`play app`, which leaves the
 * releases out), then sends the staged releases. The server goes first, so no
 * phone is offered an update ahead of the server it needs.
 */
async function deploy(): Promise<void> {
    const tag = await releaseTagAt('HEAD');
    if (!tag) fail(`no ${tagPrefix}X.Y.Z tag at or before HEAD. Ship one first.`);
    if (!(await gitSucceeds('diff', '--quiet', tag, 'HEAD', '--', ...SERVER_PATHS))) {
        fail(
            `the server code changed after ${tag}, so this would deploy code no release has. Ship again instead.`,
        );
    }
    const step = async (name: string, command: string[], env?: Record<string, string | undefined>) => {
        if (!(await timed(name, () => run(command, env)))) deployFailed(tag);
    };
    say(`Deploying the server and ${tag} to ${stack}.`);
    await step('server build', ['bun', 'run', 'build:server']);
    await step('binary', ['bun', 'scripts/pushBinary.ts', `--stack=${stack}`]);

    say(`Restarting the ${stack} server. The sudo password is for the clinic server.`);
    const url = await healthUrl(stack, await sshHost('ship'));
    const stopWatching = url ? watchHealth(url) : null;
    const restarted = await timed('server restart', () =>
        run(['scripts/play.sh', 'app', `--stack=${stack}`, '--skip-tags=releases'], {
            ...process.env,
            LUSTRE_SERVER_BUILT: '1',
        }),
    );
    const health = await stopWatching?.();
    const restart = phases.at(-1);
    if (restart && health) {
        restart.note = health.answered
            ? `API down ${health.downSeconds.toFixed(1)} s`
            : 'API never answered this machine';
    }
    if (!restarted) deployFailed(tag);

    say(`Sending the ${tag} releases to ${stack}.`);
    await step('releases', ['bun', 'scripts/pushReleases.ts', `--stack=${stack}`]);
}

function deployFailed(tag: string): never {
    fail(
        `${tag} is built and tagged, but it is not on the server. Fix what the play said, then run \`bun ship deploy${dev ? ' --dev' : ''}\`.`,
    );
}

if (deployOnly) {
    await deploy();
    printTimings();
    process.exit(0);
}

await preflight();
const version = await nextVersion();
const tag = `${tagPrefix}${version}`;
say(`Shipping ${tag}${dev ? ' on the dev track' : ''}${dryRun ? ' (dry run)' : ''}.`);

if (!dev) await cutRelease(version);
if (dryRun) {
    say(
        `Would build ${apk ? 'the APK' : withApk ? 'the update and the APK' : 'the update'}, tag ${tag}${dev ? '' : ', push main and the tag'}, and deploy the server and releases to ${stack}.`,
    );
    process.exit(0);
}

const releaseArgs = [
    apk ? 'apk' : 'update',
    ...args.filter((arg) => ['--major', '--minor', '--screen', '--with-apk'].includes(arg)),
];
const built = await timed('app build', () =>
    run(['bun', RELEASE, ...releaseArgs], { ...trackEnv, LUSTRE_EXPECT_VERSION: version }),
);
if (!built) {
    fail(`the ${version} build failed. Nothing was tagged or deployed. Fix it and run \`bun ship\` again.`);
}

if (!dev) {
    say(`Pushing main and ${tag}. GitHub publishes the release notes from the tag.`);
    if (!(await timed('push', () => run(['git', 'push', '--atomic', 'origin', 'main', tag])))) {
        fail(
            `the push failed. Push by hand (git push --atomic origin main ${tag}), then run \`bun ship deploy\`.`,
        );
    }
}

if (fast) {
    say(`Copying the releases to ${stack}. The server is left as it is.`);
    if (!(await timed('releases', () => run(['bun', 'scripts/pushReleases.ts', `--stack=${stack}`])))) {
        deployFailed(tag);
    }
} else {
    await deploy();
}
printTimings();
say(`${tag} is out.`);
