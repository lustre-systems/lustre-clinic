import {
    GRANT_TTL_MINUTES,
    grantCodeOf,
    joinUrl,
    MAX_DEVICE_LABEL,
    qrModules,
    type Role,
    roleSchema,
} from '@lustre/shared';
import { config, tailnetAddress } from '../src/config.ts';
import { sql } from '../src/db/index.ts';
import { logger } from '../src/logger.ts';
import { deviceService } from '../src/modules/device/device.service.ts';

const LABEL: Record<Role, string> = { admin: 'Admin', doctor: 'Doctor', secretary: 'Secretary' };

const QUIET = 4;

const WHITE_FG = '\x1b[97m';
const BLACK_FG = '\x1b[30m';
const WHITE_BG = '\x1b[107m';
const BLACK_BG = '\x1b[40m';
const RESET = '\x1b[0m';

function terminalQr(modules: boolean[][]): string {
    const size = modules.length + QUIET * 2;
    const dark = (row: number, col: number) => modules[row - QUIET]?.[col - QUIET] === true;

    const lines: string[] = [];
    for (let row = 0; row < size; row += 2) {
        let line = '';
        for (let col = 0; col < size; col += 1) {
            const fg = dark(row, col) ? BLACK_FG : WHITE_FG;
            const bg = row + 1 < size && dark(row + 1, col) ? BLACK_BG : WHITE_BG;
            line += `${fg}${bg}▀`;
        }
        lines.push(`${line}${RESET}`);
    }
    return lines.join('\n');
}

const [roleArg, ...labelWords] = process.argv.slice(2);
const role = roleSchema.safeParse(roleArg);

if (!role.success) {
    logger.error(`usage: grant <admin|doctor|secretary> [label]`);
    process.exitCode = 1;
} else {
    const label = (labelWords.join(' ').trim() || LABEL[role.data]).slice(0, MAX_DEVICE_LABEL);
    try {
        const grant = await deviceService.issue({ role: role.data, label }, null);
        const expires = grant.expiresAt.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: config.CLINIC_TIME_ZONE,
        });
        const code = grantCodeOf(grant.payload);
        const qr = tailnetAddress && code ? joinUrl(tailnetAddress, code) : grant.payload;
        const how =
            qr === grant.payload
                ? 'Scan it in the app: Settings → Scan a role code.'
                : 'Scan it with the phone’s camera to get the app, or in the app: Settings → Scan a role code.';
        process.stdout.write(
            `\n${terminalQr(qrModules(qr))}\n\n` +
                `${LABEL[role.data]} code for "${label}". ${how}\n` +
                `One phone, once, within ${GRANT_TTL_MINUTES} minutes (until ${expires}).\n\n`,
        );
    } catch (err) {
        logger.error({ err }, 'grant failed');
        process.exitCode = 1;
    }
}

await sql.end();
