import { join } from 'node:path';
import postgres from 'postgres';
import { config } from '../config.ts';

function bin(name: string): string {
    return config.PG_BIN_DIR ? join(config.PG_BIN_DIR, name) : name;
}

async function run(cmd: string[]): Promise<void> {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

    if (exitCode !== 0) {
        throw new Error(`${cmd[0]} exited ${exitCode}: ${stderr.trim().slice(0, 500)}`);
    }
}

export async function pgDump(databaseUrl: string, outFile: string): Promise<void> {
    await run([
        bin('pg_dump'),
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        outFile,
        databaseUrl,
    ]);
}

export async function pgRestore(databaseUrl: string, dumpFile: string): Promise<void> {
    await run([bin('pg_restore'), '--no-owner', '--no-privileges', '--dbname', databaseUrl, dumpFile]);
}

function withDatabase(databaseUrl: string, database: string): string {
    const url = new URL(databaseUrl);
    url.pathname = `/${database}`;
    return url.toString();
}

export function databaseName(databaseUrl: string): string {
    return new URL(databaseUrl).pathname.replace(/^\//, '');
}

export async function recreateDatabase(databaseUrl: string, name: string): Promise<string> {
    const admin = postgres(withDatabase(databaseUrl, 'postgres'), { max: 1, onnotice: () => {} });
    try {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin.unsafe(`CREATE DATABASE "${name}"`);
    } finally {
        await admin.end();
    }
    return withDatabase(databaseUrl, name);
}

export async function withScratchDatabase<T>(
    databaseUrl: string,
    name: string,
    fn: (scratchUrl: string) => Promise<T>,
): Promise<T> {
    const admin = postgres(withDatabase(databaseUrl, 'postgres'), { max: 1, onnotice: () => {} });

    try {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.unsafe(`CREATE DATABASE "${name}"`);

        try {
            return await fn(withDatabase(databaseUrl, name));
        } finally {
            await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        }
    } finally {
        await admin.end();
    }
}
