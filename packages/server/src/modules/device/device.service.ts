/**
 * Role grants and the phones that redeemed them.
 *
 * An admin issues a grant for a role; its code goes out as a QR and only the
 * code's hash is kept. The phone that scans it redeems it once, inside its
 * expiry, and is handed a credential — a random token, again kept only as a
 * hash — that it sends on every request. `authorize` turns that header back into
 * the role the server acts on, so what a phone may do is never the phone's say.
 *
 * A phone with no credential is the upgrade path: while the clinic has not
 * turned `requireProvisioning` on it keeps today's access, and `role` is null
 * for it. A credential that is revoked or unknown is refused either way, which
 * is what makes revoking mean something before the switch is flipped.
 *
 * Codes and tokens are never logged. Grant and device IDs and roles are.
 */
import {
    DEVICE_TOKEN_HEADER,
    ERROR_CODE,
    GRANT_TTL_MINUTES,
    grantCodeOf,
    grantPayload,
    managesClinic,
    type Role,
    seesPayments,
    seesStats,
    WS_EVENT,
} from '@lustre/shared';
import { and, desc, eq, gt, isNotNull, isNull, lte, notExists, or } from 'drizzle-orm';
import { serverEnvironment } from '../../config.ts';
import { type DatabaseEnvironment, databaseEnvironment } from '../../db/environment.ts';
import { db, type Executor, sql } from '../../db/index.ts';
import { devices, roleGrants } from '../../db/schema.ts';
import { AppError, isAppError } from '../../errors/AppError.ts';
import { logger } from '../../logger.ts';
import { broadcast, disconnectDevice, disconnectUnprovisioned } from '../../ws/index.ts';
import { settingsService } from '../settings/settings.service.ts';
import type { IssueGrantInput } from './device.schema.ts';

/** Who is asking. `role` null is a phone with no credential, let in because provisioning is not yet required. */
interface Caller {
    deviceId: string | null;
    role: Role | null;
}

interface IssuedGrant {
    id: string;
    role: Role;
    label: string;
    expiresAt: Date;
    /** The QR's text. Returned once, here, and never again. */
    payload: string;
}

interface Redeemed {
    token: string;
    deviceId: string;
    role: Role;
    label: string;
}

interface DeviceIdentity {
    deviceId: string;
    role: Role;
    label: string;
}

type GrantStatus = 'pending' | 'redeemed' | 'expired' | 'revoked';

/**
 * What the admin's list shows: codes waiting to be scanned, and the phones
 * using theirs. A code that was withdrawn, replaced by the phone's next one, or
 * never used before it expired is deleted rather than listed.
 */
interface GrantRecord {
    id: string;
    role: Role;
    label: string;
    status: 'pending' | 'redeemed';
    /** Null when the server's CLI issued it. */
    issuedBy: string | null;
    issuedAt: Date;
    expiresAt: Date;
    redeemedAt: Date | null;
    /** The phone it made, once redeemed. */
    deviceId: string | null;
}

function randomToken(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

function hashOf(secret: string): string {
    return new Bun.CryptoHasher('sha256').update(secret).digest('hex');
}

/** `Bearer <token>`, or a bare token. Anything else is no credential at all. */
export function tokenFrom(headers: Headers): string | null {
    const value = headers.get(DEVICE_TOKEN_HEADER)?.trim();
    if (!value) return null;
    const token = value.replace(/^Bearer\s+/i, '');
    return token.length > 0 ? token : null;
}

function statusOf(row: typeof roleGrants.$inferSelect, now: Date): GrantStatus {
    if (row.revokedAt) return 'revoked';
    if (row.redeemedAt) return 'redeemed';
    if (row.expiresAt <= now) return 'expired';
    return 'pending';
}

/**
 * The live admin phones, locked until the transaction ends. Every change that
 * could leave the clinic without an admin takes this first, so two of them
 * racing are decided one after the other, the second seeing the first's
 * result rather than a count taken before it.
 */
async function lockAdmins(executor: Executor): Promise<string[]> {
    const rows = await executor
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.role, 'admin'), isNull(devices.revokedAt)))
        .orderBy(devices.id)
        .for('update');
    return rows.map((row) => row.id);
}

/** A code and the phone it made, gone: a withdrawn or replaced role leaves nothing behind. */
async function deleteGrant(executor: Executor, grantId: string): Promise<void> {
    await executor.delete(devices).where(eq(devices.grantId, grantId));
    await executor.delete(roleGrants).where(eq(roleGrants.id, grantId));
}

/**
 * Codes nobody used before they expired, and anything left retired by an
 * earlier build, which marked withdrawn and replaced rows rather than deleting
 * them.
 */
async function purge(executor: Executor): Promise<void> {
    const now = new Date();
    await executor.delete(devices).where(isNotNull(devices.revokedAt));
    await executor
        .delete(roleGrants)
        .where(
            or(
                isNotNull(roleGrants.revokedAt),
                and(isNull(roleGrants.redeemedAt), lte(roleGrants.expiresAt, now)),
                and(
                    isNotNull(roleGrants.redeemedAt),
                    notExists(executor.select().from(devices).where(eq(devices.grantId, roleGrants.id))),
                ),
            ),
        );
}

async function deviceFor(token: string): Promise<typeof devices.$inferSelect | null> {
    const [row] = await db
        .select()
        .from(devices)
        .where(eq(devices.tokenHash, hashOf(token)))
        .limit(1);
    return row ?? null;
}

function notProvisioned(): AppError {
    return new AppError(
        ERROR_CODE.DEVICE_NOT_PROVISIONED,
        'this phone has no role and the clinic requires one',
        401,
    );
}

function revoked(): AppError {
    return new AppError(ERROR_CODE.DEVICE_REVOKED, 'this phone’s credential is revoked or unknown', 401);
}

function forbidden(what: string): AppError {
    return new AppError(ERROR_CODE.ROLE_FORBIDDEN, `this role may not ${what}`, 403);
}

/** Whether `devRole` may hand out a role: only when the process and its database both say development. */
export function allowsDevRole(server: 'production' | 'development', database: DatabaseEnvironment): boolean {
    return server === 'development' && database === 'development';
}

export const deviceService = {
    /**
     * The caller behind a request's credential header. Throws when the phone
     * must not be let in: a credential that is not live, or none while the
     * clinic requires one.
     */
    async authorize(token: string | null): Promise<Caller> {
        if (token === null) {
            if (await settingsService.requireProvisioning()) throw notProvisioned();
            return { deviceId: null, role: null };
        }
        const device = await deviceFor(token);
        if (!device || device.revokedAt) throw revoked();
        return { deviceId: device.id, role: device.role };
    },

    /** Whether `/ws` may be opened with this credential. The same rule as `authorize`, without the error. */
    async admitsSocket(token: string | null): Promise<{ deviceId: string | null } | null> {
        try {
            const caller = await this.authorize(token);
            return { deviceId: caller.deviceId };
        } catch (err) {
            // A refusal is an answer; a database that did not answer is not,
            // and goes to the server's error path like any other failure.
            const refused =
                isAppError(err) &&
                (err.code === ERROR_CODE.DEVICE_REVOKED || err.code === ERROR_CODE.DEVICE_NOT_PROVISIONED);
            if (refused) return null;
            throw err;
        }
    },

    assertAdmin(caller: Caller): void {
        if (caller.role !== 'admin') throw forbidden('manage roles');
    },

    assertManagesClinic(caller: Caller): void {
        if (!managesClinic(caller.role)) throw forbidden('change how the clinic is set up');
    },

    assertSeesPayments(caller: Caller): void {
        if (!seesPayments(caller.role)) throw forbidden('see payments');
    },

    assertSeesStats(caller: Caller): void {
        if (!seesStats(caller.role)) throw forbidden("see the clinic's figures");
    },

    /** What this phone's credential says about it, or null when it has none that is live. Never throws for it. */
    async me(token: string | null): Promise<DeviceIdentity | null> {
        if (token === null) return null;
        const device = await deviceFor(token);
        if (!device || device.revokedAt) return null;
        return { deviceId: device.id, role: device.role, label: device.label };
    },

    async issue(input: IssueGrantInput, issuedBy: string | null): Promise<IssuedGrant> {
        const code = randomToken();
        const id = Bun.randomUUIDv7();
        const expiresAt = new Date(Date.now() + GRANT_TTL_MINUTES * 60_000);

        await db.insert(roleGrants).values({
            id,
            role: input.role,
            label: input.label,
            codeHash: hashOf(code),
            issuedBy,
            expiresAt,
        });

        logger.info({ grantId: id, role: input.role, issuedBy }, 'role grant issued');
        broadcast(WS_EVENT.DEVICES_UPDATED);
        return { id, role: input.role, label: input.label, expiresAt, payload: grantPayload(code) };
    },

    /**
     * Single-use under concurrency: the grant is claimed by one conditional
     * UPDATE, so two phones scanning the same code at once cannot both get it.
     * When nothing is claimed the row is read again only to say why.
     *
     * `previous` is the credential the phone sent with the scan, if it had one.
     * A phone is one device: taking a new role deletes the old credential and
     * its code, so the admin's list has one entry per phone.
     */
    async redeem(code: string, previous: string | null = null): Promise<Redeemed> {
        const codeHash = hashOf(code);
        const token = randomToken();

        const redeemed = await db.transaction(async (tx) => {
            const now = new Date();
            const [grant] = await tx
                .update(roleGrants)
                .set({ redeemedAt: now })
                .where(
                    and(
                        eq(roleGrants.codeHash, codeHash),
                        isNull(roleGrants.redeemedAt),
                        isNull(roleGrants.revokedAt),
                        gt(roleGrants.expiresAt, now),
                    ),
                )
                .returning();

            if (!grant) return null;

            const deviceId = Bun.randomUUIDv7();
            await tx.insert(devices).values({
                id: deviceId,
                grantId: grant.id,
                role: grant.role,
                label: grant.label,
                tokenHash: hashOf(token),
            });
            const [old] = previous
                ? await tx
                      .select({ id: devices.id, grantId: devices.grantId, role: devices.role })
                      .from(devices)
                      .where(eq(devices.tokenHash, hashOf(previous)))
                      .limit(1)
                : [];
            // The clinic's last admin phone giving up the role would leave
            // nobody to make codes but the server's CLI — the same reason an
            // admin cannot withdraw its own. Refused, and the code is kept.
            if (old?.role === 'admin' && grant.role !== 'admin') {
                const admins = await lockAdmins(tx);
                if (!admins.some((id) => id !== old.id)) {
                    throw new AppError(ERROR_CODE.LAST_ADMIN, 'this is the only admin phone', 409);
                }
            }
            if (old) await deleteGrant(tx, old.grantId);
            return {
                grantId: grant.id,
                deviceId,
                role: grant.role,
                label: grant.label,
                replaced: old?.id ?? null,
            };
        });

        if (!redeemed) {
            const [grant] = await db
                .select()
                .from(roleGrants)
                .where(eq(roleGrants.codeHash, codeHash))
                .limit(1);
            const status = grant ? statusOf(grant, new Date()) : null;
            logger.warn({ grantId: grant?.id ?? null, status }, 'role grant refused');
            if (status === 'redeemed')
                throw new AppError(ERROR_CODE.GRANT_USED, 'grant already redeemed', 409);
            if (status === 'revoked') throw new AppError(ERROR_CODE.GRANT_REVOKED, 'grant revoked', 422);
            if (status === 'expired') throw new AppError(ERROR_CODE.GRANT_EXPIRED, 'grant expired', 422);
            throw new AppError(ERROR_CODE.GRANT_INVALID, 'no such grant', 404);
        }

        // The old credential's socket goes with it.
        if (redeemed.replaced) disconnectDevice(redeemed.replaced);
        logger.info(
            {
                grantId: redeemed.grantId,
                deviceId: redeemed.deviceId,
                role: redeemed.role,
                replaced: redeemed.replaced,
            },
            'role grant redeemed',
        );
        broadcast(WS_EVENT.DEVICES_UPDATED);
        return { token, deviceId: redeemed.deviceId, role: redeemed.role, label: redeemed.label };
    },

    /**
     * A dev server hands a phone any role it asks for, so a developer is not
     * scanning codes from a second phone to test the first. The same issue and
     * redeem an admin's code goes through, so the phone ends up a device like
     * any other. Refused unless both the process and its database say
     * development: the clinic's server must never give a role away.
     */
    async devRole(role: Role, previous: string | null = null): Promise<Redeemed> {
        if (!allowsDevRole(serverEnvironment, await databaseEnvironment(sql))) {
            throw forbidden('pick a role without a code outside development');
        }
        const grant = await this.issue({ role, label: `Dev ${role}` }, null);
        const code = grantCodeOf(grant.payload);
        if (!code) throw new Error('issued payload is not a grant');
        return this.redeem(code, previous);
    },

    async grants(): Promise<GrantRecord[]> {
        await purge(db);
        const rows = await db
            .select({ grant: roleGrants, deviceId: devices.id })
            .from(roleGrants)
            .leftJoin(devices, eq(devices.grantId, roleGrants.id))
            .orderBy(desc(roleGrants.issuedAt));

        return rows.map(({ grant, deviceId }) => ({
            id: grant.id,
            role: grant.role,
            label: grant.label,
            status: grant.redeemedAt ? 'redeemed' : 'pending',
            issuedBy: grant.issuedBy,
            issuedAt: grant.issuedAt,
            expiresAt: grant.expiresAt,
            redeemedAt: grant.redeemedAt,
            deviceId,
        }));
    },

    /**
     * Withdraws a code, and the phone it made if it was already used: both are
     * deleted, and the phone's next request is refused as a credential the
     * server does not know. A phone cannot revoke its own grant — that would
     * lock the last admin out with nobody to let it back in but the server's
     * CLI.
     */
    async revoke(grantId: string, caller: Caller): Promise<void> {
        // The grant row is locked first: `redeem` claims it with an UPDATE, so
        // a scan landing mid-revoke either commits before this reads the
        // device, or waits and finds the grant revoked.
        const deviceId = await db.transaction(async (tx) => {
            const [grant] = await tx
                .select()
                .from(roleGrants)
                .where(eq(roleGrants.id, grantId))
                .for('update')
                .limit(1);
            if (!grant) throw AppError.notFound('grant');

            const [device] = await tx.select().from(devices).where(eq(devices.grantId, grantId)).limit(1);
            if (device && device.id === caller.deviceId) throw forbidden('revoke its own role');
            // Two admins withdrawing each other at once: the second, waiting
            // on the lock, finds it is no longer an admin and is refused.
            if (device?.role === 'admin') {
                const admins = await lockAdmins(tx);
                if (!caller.deviceId || !admins.includes(caller.deviceId)) throw forbidden('manage roles');
            }

            await deleteGrant(tx, grantId);
            return device?.id ?? null;
        });

        if (deviceId) disconnectDevice(deviceId);
        logger.info({ grantId, deviceId, revokedBy: caller.deviceId }, 'role grant revoked');
        broadcast(WS_EVENT.DEVICES_UPDATED);
    },

    async setRequireProvisioning(required: boolean, caller: Caller) {
        const settings = await settingsService.setRequireProvisioning(required);
        if (required) disconnectUnprovisioned();
        logger.info({ required, by: caller.deviceId }, 'provisioning requirement changed');
        return settings;
    },
};
