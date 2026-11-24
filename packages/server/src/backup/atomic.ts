import { open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseBackupFileName } from './retention.ts';

const PARTIAL = /^(.+)\.[0-9a-f-]+\.partial$/;

async function fsync(path: string): Promise<void> {
    const handle = await open(path, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

export async function commitDump(
    path: string,
    produce: (partialPath: string) => Promise<void>,
): Promise<void> {
    const partial = `${path}.${Bun.randomUUIDv7()}.partial`;

    try {
        await produce(partial);
        await fsync(partial);
        await rename(partial, path);
    } catch (err) {
        await unlink(partial).catch(() => {});
        throw err;
    }

    await fsync(dirname(path));
}

export async function removePartialDumps(directory: string): Promise<string[]> {
    let names: string[];
    try {
        names = await readdir(directory);
    } catch {
        return [];
    }

    const partials = names.filter((name) => {
        const final = PARTIAL.exec(name)?.[1];
        return final !== undefined && parseBackupFileName(final) !== null;
    });
    for (const name of partials) {
        await unlink(join(directory, name));
    }
    return partials;
}
