const FILE_PREFIX = 'lustre-';
const FILE_SUFFIX = '.dump';

export function backupFileName(at: Date): string {
    const stamp = at
        .toISOString()
        .replace(/\.\d+Z$/, 'Z')
        .replaceAll(':', '-');
    return `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`;
}

export function parseBackupFileName(name: string): Date | null {
    if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) return null;

    const stamp = name.slice(FILE_PREFIX.length, -FILE_SUFFIX.length);
    const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z');
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? null : at;
}

export interface BackupFile {
    readonly name: string;
    readonly at: Date;
}

export interface RetentionPolicy {
    readonly daily: number;
    readonly weekly: number;
    readonly monthly: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { daily: 14, weekly: 8, monthly: 12 };

function dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
    return d.toISOString().slice(0, 7);
}

function weekKey(d: Date): string {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayOfWeek = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dayOfWeek + 3);
    const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
    const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function keepByBucket<T extends BackupFile>(
    sorted: readonly T[],
    key: (d: Date) => string,
    count: number,
): Set<T> {
    const kept = new Set<T>();
    const seen = new Set<string>();

    for (const file of sorted) {
        const bucket = key(file.at);
        if (seen.has(bucket)) continue;
        if (seen.size >= count) break;
        seen.add(bucket);
        kept.add(file);
    }

    return kept;
}

export function selectRetained<T extends BackupFile>(
    files: readonly T[],
    policy: RetentionPolicy = DEFAULT_RETENTION,
): Set<T> {
    const sorted = [...files].sort((a, b) => b.at.getTime() - a.at.getTime());

    return new Set([
        ...keepByBucket(sorted, dayKey, policy.daily),
        ...keepByBucket(sorted, weekKey, policy.weekly),
        ...keepByBucket(sorted, monthKey, policy.monthly),
    ]);
}

export function selectForDeletion<T extends BackupFile>(
    files: readonly T[],
    policy: RetentionPolicy = DEFAULT_RETENTION,
): T[] {
    const retained = selectRetained(files, policy);
    return [...files].sort((a, b) => b.at.getTime() - a.at.getTime()).filter((f) => !retained.has(f));
}
