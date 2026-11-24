import { ERROR_CODE, GRANT_TTL_MINUTES, grantPayload, type Role, WS_EVENT } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { type DeviceRow, getDb, type RoleGrantRow, save } from '../db';
import { broadcast } from '../events';
import { DemoError, uuidv7 } from '../rules';
import type { Dated } from '../wire';

export interface DemoCaller {
    token: string | null;
    deviceId: string | null;
    role: Role | null;
}

function deleteGrant(grantId: string): void {
    const db = getDb();
    db.devices = db.devices.filter((device) => device.grantId !== grantId);
    db.roleGrants = db.roleGrants.filter((grant) => grant.id !== grantId);
}

function purge(now: Date): void {
    const db = getDb();
    db.roleGrants = db.roleGrants.filter((grant) => grant.redeemedAt !== null || grant.expiresAt > now);
}

function liveDevice(token: string | null): DeviceRow | null {
    if (token === null) return null;
    const device = getDb().devices.find((row) => row.token === token);
    return device && !device.revokedAt ? device : null;
}

export function authorizeDemo(token: string | null): DemoCaller {
    if (token === null) {
        if (getDb().settings.requireProvisioning) {
            throw new DemoError(ERROR_CODE.DEVICE_NOT_PROVISIONED, 'this phone has no role', 401);
        }
        return { token, deviceId: null, role: null };
    }
    const device = liveDevice(token);
    if (!device) throw new DemoError(ERROR_CODE.DEVICE_REVOKED, 'credential revoked or unknown', 401);
    return { token, deviceId: device.id, role: device.role };
}

function issue(role: Role, label: string, issuedBy: string | null) {
    const code = uuidv7();
    const row: RoleGrantRow = {
        id: uuidv7(),
        role,
        label,
        code,
        issuedBy,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + GRANT_TTL_MINUTES * 60_000),
        redeemedAt: null,
        revokedAt: null,
    };
    getDb().roleGrants.push(row);
    save();
    broadcast(WS_EVENT.DEVICES_UPDATED);
    return { row, code };
}

function redeem(code: string, previous: string | null = null) {
    const db = getDb();
    const now = new Date();
    const grant = db.roleGrants.find((row) => row.code === code);
    if (!grant) throw new DemoError(ERROR_CODE.GRANT_INVALID, 'no such grant', 404);
    if (grant.redeemedAt) throw new DemoError(ERROR_CODE.GRANT_USED, 'grant already redeemed', 409);
    if (grant.expiresAt <= now) throw new DemoError(ERROR_CODE.GRANT_EXPIRED, 'grant expired', 422);

    const old = previous === null ? undefined : db.devices.find((row) => row.token === previous);
    const lastAdmin =
        old?.role === 'admin' &&
        grant.role !== 'admin' &&
        !db.devices.some((row) => row.role === 'admin' && row.id !== old.id && !row.revokedAt);
    if (lastAdmin) throw new DemoError(ERROR_CODE.LAST_ADMIN, 'this is the only admin phone', 409);

    grant.redeemedAt = now;
    const device: DeviceRow = {
        id: uuidv7(),
        grantId: grant.id,
        role: grant.role,
        label: grant.label,
        token: uuidv7(),
        createdAt: now,
        revokedAt: null,
    };
    if (old) deleteGrant(old.grantId);
    getDb().devices.push(device);
    save();
    broadcast(WS_EVENT.DEVICES_UPDATED);
    return { token: device.token, deviceId: device.id, role: device.role, label: device.label };
}

export function provisionDemo(
    role: Role,
    previous: string | null,
    label = `Demo ${role}`,
): ReturnType<typeof redeem> {
    const { code } = issue(role, label, null);
    return redeem(code, previous);
}

export const deviceHandlers = {
    me(_input: undefined, caller: DemoCaller): Dated<RouterOutput['device']['me']> {
        const device = liveDevice(caller.token);
        return device ? { deviceId: device.id, role: device.role, label: device.label } : null;
    },

    redeem(
        input: RouterInput['device']['redeem'],
        caller: DemoCaller,
    ): Dated<RouterOutput['device']['redeem']> {
        return redeem(input.code, caller.token);
    },

    devRole(): Dated<RouterOutput['device']['devRole']> {
        throw new DemoError(ERROR_CODE.ROLE_FORBIDDEN, 'this role may not pick a role without a code', 403);
    },

    grants(): Dated<RouterOutput['device']['grants']> {
        purge(new Date());
        const db = getDb();
        return [...db.roleGrants]
            .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
            .map((row) => {
                const device = db.devices.find((candidate) => candidate.grantId === row.id);
                return {
                    id: row.id,
                    role: row.role,
                    label: row.label,
                    status: row.redeemedAt ? ('redeemed' as const) : ('pending' as const),
                    issuedBy: row.issuedBy,
                    issuedAt: row.issuedAt,
                    expiresAt: row.expiresAt,
                    redeemedAt: row.redeemedAt,
                    deviceId: device?.id ?? null,
                };
            });
    },

    issue(input: RouterInput['device']['issue'], caller: DemoCaller): Dated<RouterOutput['device']['issue']> {
        const { row, code } = issue(input.role, input.label.trim(), caller.deviceId);
        return {
            id: row.id,
            role: row.role,
            label: row.label,
            expiresAt: row.expiresAt,
            payload: grantPayload(code),
        };
    },

    revoke(input: RouterInput['device']['revoke'], caller: DemoCaller): void {
        const db = getDb();
        const grant = db.roleGrants.find((row) => row.id === input.grantId);
        if (!grant) throw DemoError.notFound('grant');
        const device = db.devices.find((row) => row.grantId === grant.id);
        if (device && device.id === caller.deviceId) {
            throw new DemoError(ERROR_CODE.ROLE_FORBIDDEN, 'this role may not revoke its own role', 403);
        }
        deleteGrant(grant.id);
        save();
        broadcast(WS_EVENT.DEVICES_UPDATED);
    },
};
