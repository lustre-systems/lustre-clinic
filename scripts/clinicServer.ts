/**
 * How the deploy scripts (`pushBinary.ts`, `pushReleases.ts`) reach a stack on
 * the clinic server: `--stack=prod|dev`, and the SSH address from `--host`,
 * `LUSTRE_SSH`, or the one clinic in infra/ansible/inventory.yml.
 *
 * Every call shares one SSH connection (ControlMaster), so a deploy pays the
 * handshake once instead of per step. The upload is the slow part of a deploy
 * (about 145 KB/s), so the scripts send as little as they can, compressed.
 */
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { $ } from 'bun';

export const ROOT = resolve(import.meta.dir, '..');

export type Stack = 'prod' | 'dev';

export function stackDir(stack: Stack): string {
    return `/opt/lustre-${stack}`;
}

export function fail(script: string, line: string): never {
    process.stderr.write(`${script}: ${line}\n`);
    process.exit(1);
}

export function option(name: string): string | undefined {
    const prefix = `--${name}=`;
    return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function stackOption(script: string): Stack {
    const stack = option('stack');
    if (stack !== 'prod' && stack !== 'dev') fail(script, 'say which stack: --stack=prod or --stack=dev');
    return stack;
}

interface Clinics {
    hosts?: Record<string, { ansible_host?: string }>;
    vars?: { ansible_user?: string; lustre_stacks?: { name?: string; api_port?: number }[] };
}

async function clinics(): Promise<Clinics | undefined> {
    const inventory = Bun.YAML.parse(await Bun.file(join(ROOT, 'infra/ansible/inventory.yml')).text()) as {
        all?: { children?: { clinics?: Clinics } };
    };
    return inventory.all?.children?.clinics;
}

/** `user@address` of the clinic server. */
export async function sshHost(script: string): Promise<string> {
    const given = option('host') ?? process.env.LUSTRE_SSH;
    if (given) return given;
    const clinic = await clinics();
    const hosts = Object.values(clinic?.hosts ?? {});
    const address = hosts[0]?.ansible_host;
    const user = clinic?.vars?.ansible_user;
    if (hosts.length !== 1 || !address || !user) {
        fail(script, 'the inventory does not name exactly one clinic. Pass --host=user@address.');
    }
    return `${user}@${address}`;
}

/** The stack's health check over Tailscale, the address phones use. */
export async function healthUrl(stack: Stack, host: string): Promise<string | null> {
    const port = (await clinics())?.vars?.lustre_stacks?.find((entry) => entry.name === stack)?.api_port;
    const address = host.split('@').pop();
    return port && address ? `http://${address}:${port}/trpc/health.check` : null;
}

/**
 * Polls `url` four times a second until stopped, and adds up how long it did
 * not answer: how long phones could not reach the server during a deploy.
 */
export function watchHealth(url: string): () => Promise<{ answered: boolean; downSeconds: number }> {
    let running = true;
    let answered = false;
    let downSince: number | null = null;
    let down = 0;
    const loop = (async () => {
        while (running) {
            const at = performance.now();
            const ok = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(
                (response) => response.ok,
                () => false,
            );
            if (ok) {
                answered = true;
                if (downSince !== null) down += at - downSince;
                downSince = null;
            } else if (downSince === null) {
                downSince = at;
            }
            await Bun.sleep(Math.max(0, 250 - (performance.now() - at)));
        }
    })();
    return async () => {
        running = false;
        await loop;
        if (downSince !== null) down += performance.now() - downSince;
        return { answered, downSeconds: down / 1000 };
    };
}

/** Shared by every call in a deploy, and kept 60 s after the last so the next script reuses it. */
export function sshOptions(): string[] {
    const sockets = process.env.XDG_RUNTIME_DIR ?? tmpdir();
    return [
        '-o',
        'BatchMode=yes',
        '-o',
        'ControlMaster=auto',
        '-o',
        `ControlPath=${join(sockets, 'lustre-ssh-%C')}`,
        '-o',
        'ControlPersist=60',
    ];
}

/** Runs `script` with `sh` on the server and returns its output. Throws with its stderr on failure. */
export async function remote(host: string, script: string): Promise<string> {
    const result = await $`ssh ${sshOptions()} ${host} ${script}`.quiet().nothrow();
    if (result.exitCode !== 0) {
        throw new Error(`ssh ${host} exited ${result.exitCode}: ${result.stderr.toString().trim()}`);
    }
    return result.stdout.toString();
}

export interface Upload {
    /** The remote script's exit code. */
    code: number;
    bytes: number;
    seconds: number;
}

/**
 * Pipes what `command` writes (already compressed) into `script` on the server,
 * counting the bytes. On a terminal it shows how much has gone so far, since a
 * large upload on this line takes minutes.
 */
export async function upload(
    host: string,
    script: string,
    command: string[],
    cwd: string = ROOT,
): Promise<Upload> {
    const started = performance.now();
    const producer = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'inherit' });
    const ssh = Bun.spawn(['ssh', ...sshOptions(), host, script], {
        stdin: 'pipe',
        stdout: 'inherit',
        stderr: 'inherit',
    });
    let bytes = 0;
    let shown = 0;
    const progress = process.stdout.isTTY;
    try {
        for await (const chunk of producer.stdout) {
            bytes += chunk.length;
            ssh.stdin.write(chunk);
            await ssh.stdin.flush();
            if (progress && performance.now() - shown > 1000) {
                shown = performance.now();
                const rate = bytes / ((shown - started) / 1000);
                process.stdout.write(`\r  ${megabytes(bytes)} sent, ${megabytes(rate)}/s   `);
            }
        }
    } catch {
        // The server end closed early. Its exit code says why.
    }
    await ssh.stdin.end();
    const [made, code] = await Promise.all([producer.exited, ssh.exited]);
    if (progress && shown) process.stdout.write('\r\x1b[K');
    return {
        code: made === 0 ? code : made || 1,
        bytes,
        seconds: (performance.now() - started) / 1000,
    };
}

export function rate({ bytes, seconds }: Upload): string {
    return `${megabytes(bytes)} in ${seconds.toFixed(1)} s`;
}

/** Single-quoted for the remote shell. */
export function shellQuote(text: string): string {
    return `'${text.replaceAll("'", `'\\''`)}'`;
}

export async function sha256File(path: string): Promise<string> {
    const hasher = new Bun.CryptoHasher('sha256');
    const stream = Bun.file(path).stream();
    for await (const chunk of stream) hasher.update(chunk);
    return hasher.digest('hex');
}

export function megabytes(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
