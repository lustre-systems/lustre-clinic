import { z } from 'zod';
import { installClinicZone } from './util/clinicZone.ts';

const envSchema = z.object({
    DATABASE_URL: z.string().min(1),
    MIGRATION_DATABASE_URL: z
        .string()
        .min(1)
        .optional()
        .or(z.literal('').transform(() => undefined)),
    MIGRATE_ON_BOOT: z.stringbool().default(true),
    MIGRATIONS_DIR: z.string().min(1).optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    CLINIC_TIME_ZONE: z.string().min(1).default('Africa/Cairo'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DISCORD_WEBHOOK_URL: z
        .url()
        .optional()
        .or(z.literal('').transform(() => undefined)),
    HEARTBEAT_URL: z
        .url()
        .optional()
        .or(z.literal('').transform(() => undefined)),
    HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),

    TAILSCALE_HOSTNAME: z.string().optional(),
    TAILSCALE_IP: z.string().optional(),

    BACKUP_ENCRYPTION_KEY: z.string().optional(),
    BACKUP_DIR: z.string().default('./backups'),
    BACKUP_INTERVAL_HOURS: z.coerce.number().positive().default(24),
    BACKUP_STALE_AFTER_HOURS: z.coerce.number().positive().default(48),
    PG_BIN_DIR: z.string().optional(),

    RELEASES_DIR: z.string().default('./releases'),
    UPDATES_CHANNEL: z.enum(['production', 'development']).default('production'),
    SERVER_ENVIRONMENT: z.enum(['production', 'development']).optional(),

    BACKUP_DRIVE_FOLDER_ID: z.string().optional(),
    BACKUP_DRIVE_OAUTH_CLIENT_ID: z.string().optional(),
    BACKUP_DRIVE_OAUTH_CLIENT_SECRET: z.string().optional(),
    BACKUP_DRIVE_REFRESH_TOKEN: z.string().optional(),
    BACKUP_DRIVE_ANDROID_CLIENT_ID: z.string().optional(),
    BACKUP_DRIVE_ANDROID_REDIRECT_URI: z.preprocess(
        (v) => (v === '' ? undefined : v),
        z.string().default('com.lustre.clinic:/oauth2redirect'),
    ),
    BACKUP_DRIVE_CLIENT_EMAIL: z.string().optional(),
    BACKUP_DRIVE_PRIVATE_KEY: z.string().optional(),
    BACKUP_DRIVE_SUBJECT: z.string().optional(),

    BACKUP_S3_BUCKET: z.string().optional(),
    BACKUP_S3_ENDPOINT: z.string().optional(),
    BACKUP_S3_REGION: z.string().optional(),
    BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
    BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
    BACKUP_S3_PREFIX: z.string().default('lustre'),
});

export type Config = z.infer<typeof envSchema>;

function load(): Config {
    const parsed = envSchema.safeParse(Bun.env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid environment:\n${issues}`);
    }
    return parsed.data;
}

export const config = load();
installClinicZone(config.CLINIC_TIME_ZONE);

function isTailnetIp(value: string): boolean {
    const [first, second] = value.split('.').map(Number);
    return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

function asBaseUrl(host: string, port: number): string {
    const trimmed = host.trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return trimmed.includes(':') ? `http://${trimmed}` : `http://${trimmed}:${port}`;
}

export function resolveTailnetAddress(env: Config): string | null {
    const hostname = env.TAILSCALE_HOSTNAME?.trim();
    if (hostname) return asBaseUrl(hostname, env.PORT);

    const ip = env.TAILSCALE_IP?.trim();
    return ip && isTailnetIp(ip) ? asBaseUrl(ip, env.PORT) : null;
}

export const tailnetAddress = resolveTailnetAddress(config);

export function resolveServerEnvironment(env: Config): 'production' | 'development' {
    return env.SERVER_ENVIRONMENT ?? (env.NODE_ENV === 'production' ? 'production' : 'development');
}

export const serverEnvironment = resolveServerEnvironment(config);
