export interface Version {
    major: number;
    minor: number;
    patch: number;
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(text: string): Version | null {
    const match = text.trim().match(SEMVER);
    if (!match) return null;
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatVersion({ major, minor, patch }: Version): string {
    return `${major}.${minor}.${patch}`;
}

export function compareVersions(a: Version, b: Version): number {
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function highest(texts: readonly (string | null | undefined)[]): Version | null {
    let best: Version | null = null;
    for (const text of texts) {
        const version = text ? parseVersion(text) : null;
        if (version && (!best || compareVersions(version, best) > 0)) best = version;
    }
    return best;
}

export const FIRST_VERSION: Version = { major: 1, minor: 0, patch: 0 };

export function nextApkVersion(released: readonly (string | null | undefined)[], major = false): Version {
    const last = highest(released);
    if (!last) return FIRST_VERSION;
    return major
        ? { major: last.major + 1, minor: 0, patch: 0 }
        : { major: last.major, minor: last.minor + 1, patch: 0 };
}

export function nextUpdateVersion(
    apk: Version,
    released: readonly (string | null | undefined)[],
    minor = false,
): Version {
    const since = released.filter((text) => {
        const version = text ? parseVersion(text) : null;
        return version !== null && version.major === apk.major && compareVersions(version, apk) >= 0;
    });
    const last = highest([formatVersion(apk), ...since]) ?? apk;
    return minor
        ? { major: last.major, minor: last.minor + 1, patch: 0 }
        : { ...last, patch: last.patch + 1 };
}

export function tagFor(version: Version): string {
    return `v${formatVersion(version)}`;
}
