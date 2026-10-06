/**
 * Puts `dist/lustre` and `dist/migrations` in a stack's directory, where the
 * deploy's `docker compose build` takes them from. `bun ship` runs it before
 * the play, and the play's `app` tag runs it too.
 *
 *   bun scripts/pushBinary.ts --stack=prod|dev [--host=user@address]
 *
 * A binary the server already has (same sha256) is not sent. Otherwise only a
 * `zstd --patch-from` delta against the binary on the server goes: the Bun
 * runtime is most of the 76 MB and never changes between builds, so a week of
 * server changes is a few hundred KB. Making the delta needs the server's
 * binary here too. Every binary pushed is kept in ~/.cache/lustre/server by its
 * sha256, and one that is not is fetched from the server once, compressed:
 * downloading runs about five times faster than uploading.
 *
 * The server checks the sha256 of what it rebuilt and renames it into place
 * only if it matches. Anything wrong with the delta sends the whole binary
 * instead, compressed with zstd -19 (28 MB rather than 76). The running
 * container never reads this file; the image build copies it.
 */
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import {
    fail,
    megabytes,
    ROOT,
    rate,
    remote,
    sha256File,
    sshHost,
    sshOptions,
    stackDir,
    stackOption,
    upload,
} from './clinicServer';

const SCRIPT = 'pushBinary';
const stack = stackOption(SCRIPT);
const host = await sshHost(SCRIPT);
const DIR = stackDir(stack);
const BINARY = join(ROOT, 'dist/lustre');
const MIGRATIONS = join(ROOT, 'dist/migrations');
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'lustre/server');
/** Enough for the binary on prod, the one on dev, and the ones about to replace them. */
const KEEP = 4;

if (!(await stat(BINARY).catch(() => null)))
    fail(SCRIPT, 'dist/lustre is missing. Run `bun run build:server`.');

const INSPECT = `set -eu
[ -d ${DIR} ] || { echo "${DIR} does not exist. Set the stack up first: bun play app --stack=${stack}" >&2; exit 3; }
cd ${DIR}/dist 2>/dev/null || exit 0
if [ -f lustre ]; then echo "binary $(sha256sum < lustre | cut -d' ' -f1)"; fi
if [ -d migrations ]; then cd migrations && find . -type f -exec sha256sum {} + | sed 's/^/migration /'; fi`;

/** The remote scripts' code when another push to this stack holds the lock. */
const BUSY = 75;

/** One push at a time per stack, so no other run touches the `.incoming` files in between. */
const LOCKED = `set -eu
mkdir -p ${DIR}/dist
exec 9>${DIR}/.binary.lock
flock -n 9 || { echo "Another push to ${DIR}/dist is still running." >&2; exit ${BUSY}; }
cd ${DIR}/dist`;

function applyBinary(sha256: string, delta: boolean): string {
    return `${LOCKED}
rm -f lustre.incoming
zstd -dq --memory=1024MB ${delta ? '--patch-from=lustre ' : ''}-o lustre.incoming
if [ "$(sha256sum < lustre.incoming | cut -d' ' -f1)" != ${sha256} ]; then
    rm -f lustre.incoming
    echo "The rebuilt binary does not match." >&2
    exit 65
fi
chmod 755 lustre.incoming
mv -f lustre.incoming lustre`;
}

/** Swapped in with one rename, so there is never a moment without a migrations directory. */
const APPLY_MIGRATIONS = `${LOCKED}
umask 022
rm -rf migrations.incoming
mkdir migrations.incoming
tar --zstd -xf - -C migrations.incoming --no-same-owner
if [ -d migrations ]; then
    mv -T --exchange migrations.incoming migrations
    rm -rf migrations.incoming
else
    mv migrations.incoming migrations
fi`;

function say(line: string): void {
    process.stdout.write(`${line}\n`);
}

async function localMigrations(): Promise<string[]> {
    const files = await readdir(MIGRATIONS, { recursive: true, withFileTypes: true });
    return Promise.all(
        files
            .filter((file) => file.isFile())
            .map(async (file) => {
                const path = join(file.parentPath, file.name);
                return `${await sha256File(path)} ${relative(MIGRATIONS, path)}`;
            }),
    ).then((lines) => lines.sort());
}

async function cached(sha256: string): Promise<string | null> {
    const path = join(CACHE, sha256);
    return (await stat(path).catch(() => null)) ? path : null;
}

/** Downloads the server's binary into the cache. Null when that fails or comes out different. */
async function fetchFromServer(sha256: string): Promise<string | null> {
    await mkdir(CACHE, { recursive: true });
    const path = join(CACHE, sha256);
    const part = `${path}.part`;
    const started = performance.now();
    const ssh = Bun.spawn(['ssh', ...sshOptions(), host, `zstd -q -3 -T0 -c ${DIR}/dist/lustre`], {
        stdout: 'pipe',
        stderr: 'inherit',
    });
    const unpack = Bun.spawn(['zstd', '-dqf', '-o', part], { stdin: ssh.stdout, stderr: 'inherit' });
    const [fetched, unpacked] = await Promise.all([ssh.exited, unpack.exited]);
    if (fetched !== 0 || unpacked !== 0 || (await sha256File(part)) !== sha256) {
        await rm(part, { force: true });
        return null;
    }
    await rename(part, path);
    say(`  Fetched it in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
    return path;
}

async function remember(sha256: string): Promise<void> {
    await mkdir(CACHE, { recursive: true });
    if (!(await cached(sha256))) {
        await Bun.write(`${join(CACHE, sha256)}.part`, Bun.file(BINARY));
        await rename(`${join(CACHE, sha256)}.part`, join(CACHE, sha256));
    }
    const kept = await Promise.all(
        (await readdir(CACHE))
            .filter((name) => /^[0-9a-f]{64}$/.test(name))
            .map(async (name) => ({ name, at: (await stat(join(CACHE, name))).mtimeMs })),
    );
    for (const { name } of kept.sort((a, b) => b.at - a.at).slice(KEEP)) {
        await rm(join(CACHE, name), { force: true });
    }
}

async function pushBinary(sha256: string, onServer: string | undefined): Promise<void> {
    if (onServer) {
        let base = await cached(onServer);
        if (!base) {
            say(`The ${stack} binary is not cached here. Fetching it to make the delta against.`);
            base = await fetchFromServer(onServer);
        }
        if (base) {
            const sent = await upload(host, applyBinary(sha256, true), [
                'zstd',
                '-q',
                '-9',
                '-T0',
                `--patch-from=${base}`,
                '-c',
                BINARY,
            ]);
            if (sent.code === 0) {
                say(`Sent the binary as a delta: ${rate(sent)}.`);
                return;
            }
            if (sent.code === BUSY)
                fail(SCRIPT, 'another push to this stack is running. Run it again once it is done.');
            say(`The delta did not apply (${sent.code}). Sending the whole binary instead.`);
        }
    }
    const sent = await upload(host, applyBinary(sha256, false), ['zstd', '-q', '-19', '-T0', '-c', BINARY]);
    if (sent.code !== 0) fail(SCRIPT, `sending the binary failed (${sent.code}). Run it again.`);
    say(`Sent the whole binary: ${rate(sent)}.`);
}

let inspected: string;
try {
    inspected = await remote(host, INSPECT);
} catch (error) {
    fail(SCRIPT, (error as Error).message);
}
const lines = inspected.split('\n');
const onServer = lines.find((line) => line.startsWith('binary '))?.slice('binary '.length);
const serverMigrations = lines
    .filter((line) => line.startsWith('migration '))
    .map((line) => {
        const [sum, path] = line.slice('migration '.length).split(/\s+/, 2);
        return `${sum} ${path?.replace(/^\.\//, '')}`;
    })
    .sort();

const sha256 = await sha256File(BINARY);
if (onServer === sha256) {
    say(`The ${stack} stack already has this server binary.`);
} else {
    await pushBinary(sha256, onServer);
}
await remember(sha256);

if ((await localMigrations()).join('\n') === serverMigrations.join('\n')) {
    say(`The ${stack} stack already has these migrations.`);
} else {
    const sent = await upload(host, APPLY_MIGRATIONS, [
        'tar',
        '--use-compress-program=zstd -19 -T0',
        '-cf',
        '-',
        '-C',
        MIGRATIONS,
        '.',
    ]);
    if (sent.code !== 0) fail(SCRIPT, `sending the migrations failed (${sent.code}). Run it again.`);
    say(`Sent the migrations: ${rate(sent)}.`);
}
say(`dist/lustre (${megabytes((await stat(BINARY)).size)}) and its migrations are on the ${stack} stack.`);
