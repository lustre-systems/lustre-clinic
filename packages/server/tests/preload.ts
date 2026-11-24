const ENV_FILE = new URL('../.env.test', import.meta.url).pathname;

function parseEnvFile(contents: string): Record<string, string> {
    const values: Record<string, string> = {};

    for (const line of contents.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;

        const key = trimmed.slice(0, eq).trim();
        values[key] = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
    }

    return values;
}

const file = Bun.file(ENV_FILE);
if (!(await file.exists())) {
    throw new Error(`missing ${ENV_FILE} — the test suite has no database to run against`);
}

const testEnv = parseEnvFile(await file.text());
const explicitDatabaseUrl = Bun.env.DATABASE_URL;

for (const [key, value] of Object.entries(testEnv)) {
    Bun.env[key] = value;
}

if (explicitDatabaseUrl?.endsWith('_test')) {
    Bun.env.DATABASE_URL = explicitDatabaseUrl;
}
