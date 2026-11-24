import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE, grantCodeOf, type Role } from '@lustre/shared';
import { databaseEnvironment } from '../src/db/environment.ts';
import { allowsDevRole, deviceService } from '../src/modules/device/device.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { CHECKUP_PRICE, checkedInVisit } from './helpers/factories.ts';
import { expectTrpcError, socketAs, startTestServer, type TestServer } from './helpers/trpc.ts';

let api: TestServer;

beforeAll(async () => {
    await setupDatabase();
    api = startTestServer();
});

afterAll(() => {
    api.stop();
});

beforeEach(async () => {
    await truncateAll();
});

function codeOf(payload: string): string {
    const code = grantCodeOf(payload);
    if (!code) throw new Error('issued payload is not a grant');
    return code;
}

async function provisioned(
    role: Role,
    label = role,
): Promise<{ token: string; deviceId: string; grantId: string }> {
    const grant = await deviceService.issue({ role, label }, null);
    const redeemed = await api.client.device.redeem.mutate({ code: codeOf(grant.payload) });
    return { token: redeemed.token, deviceId: redeemed.deviceId, grantId: grant.id };
}

async function requireProvisioning(): Promise<void> {
    await sql`INSERT INTO settings (id, clinic_name, reminder_template, require_provisioning)
              VALUES (1, 'Clinic', 'x', true)
              ON CONFLICT (id) DO UPDATE SET require_provisioning = true`;
}

describe('grants', () => {
    test('redeeming a code gives the phone that role, and `me` reads it back', async () => {
        const grant = await deviceService.issue({ role: 'secretary', label: 'Reception' }, null);
        const redeemed = await api.client.device.redeem.mutate({ code: codeOf(grant.payload) });

        expect(redeemed.role).toBe('secretary');
        expect(redeemed.label).toBe('Reception');
        const me = await api.clientAs(redeemed.token).device.me.query();
        expect(me).toEqual({ deviceId: redeemed.deviceId, role: 'secretary', label: 'Reception' });
    });

    test('a code works once', async () => {
        const grant = await deviceService.issue({ role: 'doctor', label: 'Doctor' }, null);
        const code = codeOf(grant.payload);
        await api.client.device.redeem.mutate({ code });

        await expectTrpcError(ERROR_CODE.GRANT_USED, 409, () => api.client.device.redeem.mutate({ code }));
    });

    test('two phones scanning one code at once: one gets it', async () => {
        const grant = await deviceService.issue({ role: 'doctor', label: 'Doctor' }, null);
        const code = codeOf(grant.payload);

        const results = await Promise.allSettled([
            api.client.device.redeem.mutate({ code }),
            api.client.device.redeem.mutate({ code }),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const [row] = await sql`SELECT count(*)::int AS count FROM devices`;
        expect(row?.count).toBe(1);
    });

    test('an expired code is refused', async () => {
        const grant = await deviceService.issue({ role: 'doctor', label: 'Doctor' }, null);
        await sql`UPDATE role_grants SET expires_at = now() - interval '1 minute' WHERE id = ${grant.id}`;

        await expectTrpcError(ERROR_CODE.GRANT_EXPIRED, 422, () =>
            api.client.device.redeem.mutate({ code: codeOf(grant.payload) }),
        );
    });

    test('a withdrawn code is gone', async () => {
        const admin = await provisioned('admin');
        const grant = await api
            .clientAs(admin.token)
            .device.issue.mutate({ role: 'doctor', label: 'Doctor' });
        await api.clientAs(admin.token).device.revoke.mutate({ grantId: grant.id });

        await expectTrpcError(ERROR_CODE.GRANT_INVALID, 404, () =>
            api.client.device.redeem.mutate({ code: codeOf(grant.payload) }),
        );
    });

    test('a code this server never issued is refused', async () => {
        await expectTrpcError(ERROR_CODE.GRANT_INVALID, 404, () =>
            api.client.device.redeem.mutate({ code: 'A'.repeat(43) }),
        );
    });

    test('a code nobody used is deleted once it expires', async () => {
        const admin = await provisioned('admin');
        const grant = await deviceService.issue({ role: 'doctor', label: 'Late' }, null);
        await sql`UPDATE role_grants SET expires_at = now() - interval '1 minute' WHERE id = ${grant.id}`;

        const listed = await api.clientAs(admin.token).device.grants.query();
        expect(listed.find((g) => g.id === grant.id)).toBeUndefined();
        const [row] = await sql`SELECT count(*)::int AS count FROM role_grants WHERE id = ${grant.id}`;
        expect(row?.count).toBe(0);
    });

    test('only the code’s hash is stored', async () => {
        const grant = await deviceService.issue({ role: 'doctor', label: 'Doctor' }, null);
        const [row] = await sql`SELECT code_hash FROM role_grants WHERE id = ${grant.id}`;
        expect(row?.code_hash).not.toContain(codeOf(grant.payload));
    });
});

describe('the admin', () => {
    test('issues, lists and revokes; the list says which phone a code made', async () => {
        const admin = await provisioned('admin');
        const client = api.clientAs(admin.token);

        const grant = await client.device.issue.mutate({ role: 'secretary', label: 'Reception' });
        const redeemed = await api.client.device.redeem.mutate({ code: codeOf(grant.payload) });

        const listed = (await client.device.grants.query()).find((g) => g.id === grant.id);
        expect(listed?.status).toBe('redeemed');
        expect(listed?.deviceId).toBe(redeemed.deviceId);
        expect(listed?.issuedBy).toBe(admin.deviceId);

        await client.device.revoke.mutate({ grantId: grant.id });
        const after = (await client.device.grants.query()).find((g) => g.id === grant.id);
        expect(after).toBeUndefined();
        const [left] = await sql`SELECT count(*)::int AS count FROM devices WHERE grant_id = ${grant.id}`;
        expect(left?.count).toBe(0);
    });

    test('revoking a used code shuts its phone out, even before provisioning is required', async () => {
        const admin = await provisioned('admin');
        const secretary = await provisioned('secretary');

        await api.clientAs(admin.token).device.revoke.mutate({ grantId: secretary.grantId });

        await expectTrpcError(ERROR_CODE.DEVICE_REVOKED, 401, () =>
            api.clientAs(secretary.token).settings.get.query(),
        );
        expect(await api.clientAs(secretary.token).device.me.query()).toBeNull();
    });

    test('a phone that scans a new code gives up its old one, which leaves the list', async () => {
        const admin = await provisioned('admin');
        const phone = await provisioned('secretary');
        const grant = await deviceService.issue({ role: 'doctor', label: 'Surgery' }, null);

        const next = await api.clientAs(phone.token).device.redeem.mutate({ code: codeOf(grant.payload) });

        expect(next.role).toBe('doctor');
        await expectTrpcError(ERROR_CODE.DEVICE_REVOKED, 401, () =>
            api.clientAs(phone.token).settings.get.query(),
        );
        const listed = await api.clientAs(admin.token).device.grants.query();
        expect(listed.find((g) => g.id === phone.grantId)).toBeUndefined();
        expect(listed.find((g) => g.id === grant.id)?.status).toBe('redeemed');
    });

    test('the only admin phone cannot trade its role away, but can once there is another', async () => {
        const admin = await provisioned('admin');
        const doctorCode = await deviceService.issue({ role: 'doctor', label: 'Surgery' }, null);
        const redeem = () =>
            api.clientAs(admin.token).device.redeem.mutate({ code: codeOf(doctorCode.payload) });

        await expectTrpcError(ERROR_CODE.LAST_ADMIN, 409, redeem);
        expect((await api.clientAs(admin.token).device.me.query())?.role).toBe('admin');

        await provisioned('admin');
        expect((await redeem()).role).toBe('doctor');
    });

    test('two admin phones giving up the role at once leave one admin', async () => {
        const first = await provisioned('admin');
        const second = await provisioned('admin');
        const codes = await Promise.all([
            deviceService.issue({ role: 'doctor', label: 'One' }, null),
            deviceService.issue({ role: 'doctor', label: 'Two' }, null),
        ]);

        const results = await Promise.allSettled([
            api.clientAs(first.token).device.redeem.mutate({ code: codeOf(codes[0].payload) }),
            api.clientAs(second.token).device.redeem.mutate({ code: codeOf(codes[1].payload) }),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const [row] =
            await sql`SELECT count(*)::int AS count FROM devices WHERE role = 'admin' AND revoked_at IS NULL`;
        expect(row?.count).toBe(1);
    });

    test('two admins withdrawing each other at once leave one admin', async () => {
        const first = await provisioned('admin');
        const second = await provisioned('admin');

        await Promise.allSettled([
            api.clientAs(first.token).device.revoke.mutate({ grantId: second.grantId }),
            api.clientAs(second.token).device.revoke.mutate({ grantId: first.grantId }),
        ]);

        const [row] =
            await sql`SELECT count(*)::int AS count FROM devices WHERE role = 'admin' AND revoked_at IS NULL`;
        expect(row?.count).toBe(1);
    });

    test('cannot revoke its own role', async () => {
        const admin = await provisioned('admin');
        await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, () =>
            api.clientAs(admin.token).device.revoke.mutate({ grantId: admin.grantId }),
        );
    });

    for (const role of ['doctor', 'secretary'] as const) {
        test(`a ${role} cannot issue codes`, async () => {
            const phone = await provisioned(role);
            await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, () =>
                api.clientAs(phone.token).device.issue.mutate({ role: 'admin', label: 'Me' }),
            );
        });
    }

    test('a phone with no role cannot issue codes either', async () => {
        await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, () =>
            api.client.device.issue.mutate({ role: 'admin', label: 'Me' }),
        );
    });
});

describe('devRole', () => {
    test('only a development server on a development database gives a role away', () => {
        expect(allowsDevRole('development', 'development')).toBe(true);
        expect(allowsDevRole('development', 'unmarked')).toBe(false);
        expect(allowsDevRole('development', 'production')).toBe(false);
        expect(allowsDevRole('production', 'development')).toBe(false);
    });

    test('hands the phone the role it asked for, or is refused, as this database says', async () => {
        await requireProvisioning();
        if ((await databaseEnvironment(sql)) === 'development') {
            const redeemed = await api.client.device.devRole.mutate({ role: 'doctor' });
            const me = await api.clientAs(redeemed.token).device.me.query();
            expect(me?.role).toBe('doctor');
        } else {
            await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, () =>
                api.client.device.devRole.mutate({ role: 'admin' }),
            );
        }
    });
});

describe('requireProvisioning', () => {
    test('off by default: a phone with no role keeps working', async () => {
        const settings = await api.client.settings.get.query();
        expect(settings.requireProvisioning).toBe(false);
    });

    test('on: a phone with no role is refused, but can still reach health and redeem a code', async () => {
        const admin = await provisioned('admin');
        await api.clientAs(admin.token).device.setRequireProvisioning.mutate({ required: true });

        await expectTrpcError(ERROR_CODE.DEVICE_NOT_PROVISIONED, 401, () => api.client.settings.get.query());
        expect((await api.client.health.check.query()).ok).toBe(true);

        const grant = await api
            .clientAs(admin.token)
            .device.issue.mutate({ role: 'secretary', label: 'Desk' });
        const redeemed = await api.client.device.redeem.mutate({ code: codeOf(grant.payload) });
        expect((await api.clientAs(redeemed.token).settings.get.query()).requireProvisioning).toBe(true);
    });

    test('only an admin can turn it on', async () => {
        const secretary = await provisioned('secretary');
        await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, () =>
            api.clientAs(secretary.token).device.setRequireProvisioning.mutate({ required: true }),
        );
    });

    test('on: a socket with no role is refused, one with a role is let in', async () => {
        await requireProvisioning();
        const secretary = await provisioned('secretary');

        const refused = await fetch(api.wsUrl.replace('ws:', 'http:'), { headers: { upgrade: 'websocket' } });
        expect(refused.status).toBe(401);

        const ws = socketAs(api.wsUrl, secretary.token);
        const hello = await new Promise<string>((resolve, reject) => {
            ws.onmessage = (event) => resolve(String(event.data));
            ws.onerror = () => reject(new Error('socket refused'));
        });
        ws.close();
        expect(JSON.parse(hello).type).toBe('hello');
    });

    test('revoking a phone closes its open socket', async () => {
        const admin = await provisioned('admin');
        const secretary = await provisioned('secretary');

        const ws = socketAs(api.wsUrl, secretary.token);
        await new Promise<void>((resolve) => {
            ws.onmessage = () => resolve();
        });
        const closed = new Promise<number>((resolve) => {
            ws.onclose = (event) => resolve(event.code);
        });

        await api.clientAs(admin.token).device.revoke.mutate({ grantId: secretary.grantId });
        expect(await closed).toBe(1008);
    });
});

describe('a doctor and payment data', () => {
    async function paidVisit() {
        const fixtures = await checkedInVisit();
        await visitService.setProcedures({
            visitId: fixtures.visit.id,
            procedures: [{ procedureId: fixtures.checkup.id, quantity: 1 }],
        });
        await visitService.checkOut({
            visitId: fixtures.visit.id,
            chargedTotal: CHECKUP_PRICE,
            paidTotal: 10_000,
            method: 'cash',
        });
        return fixtures;
    }

    test('sees no amounts on a finished visit in a patient’s history', async () => {
        const { patient } = await paidVisit();
        const doctor = await provisioned('doctor');

        const [entry] = (await api.clientAs(doctor.token).patient.byId.query({ id: patient.id })).history;
        expect(entry?.chargedTotal).toBeNull();
        expect(entry?.computedTotal).toBeNull();
        expect(entry?.paidTotal).toBeNull();
        expect(entry?.balance).toBeNull();
    });

    test('sees a finished visit’s procedures, but no charge, price or payment', async () => {
        const { visit } = await paidVisit();
        const doctor = await provisioned('doctor');

        const read = await api.clientAs(doctor.token).visit.byId.query({ id: visit.id });
        expect(read.procedures).toHaveLength(1);
        expect(read.procedures[0]?.unitPrice).toBeNull();
        expect(read.procedures[0]?.lineTotal).toBeNull();
        expect(read.chargedTotal).toBeNull();
        expect(read.payments).toBeNull();
        expect(read.balance).toBeNull();
    });

    test('still sees prices on a visit sent to the desk, until it is checked out', async () => {
        const { visit, patient, checkup, appointment } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: checkup.id, quantity: 1 }],
        });
        await sql`UPDATE appointments SET status = 'awaiting_payment' WHERE id = ${appointment.id}`;
        const doctor = api.clientAs((await provisioned('doctor')).token);

        const read = await doctor.visit.byId.query({ id: visit.id });
        expect(read.chargedTotal).toBe(CHECKUP_PRICE);
        expect(read.payments).toBeNull();
        const [entry] = (await doctor.patient.byId.query({ id: patient.id })).history;
        expect(entry?.chargedTotal).toBe(CHECKUP_PRICE);
        expect(entry?.paidTotal).toBeNull();
    });

    test('sees prices on a visit still open, to check it out', async () => {
        const { visit, checkup } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: checkup.id, quantity: 1 }],
        });
        const doctor = await provisioned('doctor');

        const read = await api.clientAs(doctor.token).visit.byId.query({ id: visit.id });
        expect(read.procedures[0]?.unitPrice).toBe(CHECKUP_PRICE);
        expect(read.chargedTotal).toBe(CHECKUP_PRICE);
        expect(read.payments).toBeNull();
    });

    test('cannot take more at checkout than is still owed, which it cannot see', async () => {
        const { visit, checkup } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: checkup.id, quantity: 1 }],
        });
        await visitService.recordPayment({ visitId: visit.id, amount: 10_000, method: 'cash' });
        const doctor = api.clientAs((await provisioned('doctor')).token);

        await expectTrpcError(ERROR_CODE.PAYMENT_EXCEEDS_BALANCE, 422, () =>
            doctor.visit.checkOut.mutate({
                visitId: visit.id,
                chargedTotal: CHECKUP_PRICE,
                paidTotal: CHECKUP_PRICE,
                method: 'cash',
            }),
        );
    });

    test('cannot reopen a finished visit', async () => {
        const { visit } = await paidVisit();
        const doctor = api.clientAs((await provisioned('doctor')).token);
        await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, () =>
            doctor.visit.reopen.mutate({ visitId: visit.id }),
        );
    });

    test('is not told what the carried-over debt comes to', async () => {
        const doctor = api.clientAs((await provisioned('doctor')).token);
        const admin = api.clientAs((await provisioned('admin')).token);
        expect((await doctor.migration.progress.query()).openingBalanceTotal).toBeNull();
        expect((await admin.migration.progress.query()).openingBalanceTotal).toBe(0);
    });

    test('can check a patient out', async () => {
        const { visit, checkup } = await checkedInVisit();
        const doctor = api.clientAs((await provisioned('doctor')).token);
        await doctor.visit.setProcedures.mutate({
            visitId: visit.id,
            procedures: [{ procedureId: checkup.id, quantity: 1 }],
        });

        const done = await doctor.visit.checkOut.mutate({
            visitId: visit.id,
            chargedTotal: CHECKUP_PRICE,
            paidTotal: CHECKUP_PRICE,
            method: 'cash',
        });
        expect(done.completedAt).not.toBeNull();
        expect(done.balance).toBeNull();
        expect(done.chargedTotal).toBeNull();
    });

    test('is refused every read and write of payments, balances and the money stats', async () => {
        const { patient, visit } = await paidVisit();
        const doctor = api.clientAs((await provisioned('doctor')).token);
        const range = { from: '2026-01-01', to: '2026-12-31' };
        const payment = await visitService.byId(visit.id);
        const paymentId = payment.payments?.[0]?.id ?? '';

        const refused: (() => Promise<unknown>)[] = [
            () => doctor.balance.outstanding.query(),
            () => doctor.balance.byPatient.query({ patientId: patient.id }),
            () => doctor.balance.summary.query(range),
            () => doctor.balance.takings.query(range),
            () => doctor.balance.settle.mutate({ patientId: patient.id, amount: 100, method: 'cash' }),
            () => doctor.stats.summary.query(range),
            () => doctor.visit.recordPayment.mutate({ visitId: visit.id, amount: 100, method: 'cash' }),
            () => doctor.visit.setPaid.mutate({ visitId: visit.id, paidTotal: 0, method: 'cash' }),
            () => doctor.visit.deletePayment.mutate({ paymentId }),
        ];
        for (const call of refused) await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, call);
    });

    for (const role of ['admin', 'secretary'] as const) {
        test(`${role} keeps everything`, async () => {
            const { patient, visit } = await paidVisit();
            const phone = api.clientAs((await provisioned(role)).token);

            const [entry] = (await phone.patient.byId.query({ id: patient.id })).history;
            expect(entry?.chargedTotal).toBe(CHECKUP_PRICE);
            expect(entry?.paidTotal).toBe(10_000);
            expect(entry?.balance).toBe(CHECKUP_PRICE - 10_000);
            expect((await phone.visit.byId.query({ id: visit.id })).payments).toHaveLength(1);
            expect((await phone.balance.outstanding.query()).total).toBe(CHECKUP_PRICE - 10_000);
        });
    }

    test('a phone with no role keeps everything until provisioning is required', async () => {
        const { patient } = await paidVisit();
        const [entry] = (await api.client.patient.byId.query({ id: patient.id })).history;
        expect(entry?.balance).toBe(CHECKUP_PRICE - 10_000);
        expect((await api.client.balance.outstanding.query()).total).toBe(CHECKUP_PRICE - 10_000);
    });
});

describe('ref edits', () => {
    test('a secretary’s phone edits a ref and is recorded as the secretary, whatever it claims', async () => {
        const { patient } = await checkedInVisit();
        const secretary = api.clientAs((await provisioned('secretary')).token);

        const moved = await secretary.patient.updateRef.mutate({
            id: patient.id,
            ref: 'K7MX',
            editedBy: 'doctor',
        });
        expect(moved.ref).toBe('K7MX');
        const [entry] = await secretary.patient.refHistory.query({ id: patient.id });
        expect(entry?.editedBy).toBe('secretary');
    });

    test('an admin edits as the doctor it draws', async () => {
        const { patient } = await checkedInVisit();
        const admin = api.clientAs((await provisioned('admin')).token);

        const moved = await admin.patient.updateRef.mutate({
            id: patient.id,
            ref: 'K7MX',
            editedBy: 'secretary',
        });
        expect(moved.ref).toBe('K7MX');
    });
});

describe('setting the clinic up', () => {
    for (const role of ['doctor', 'secretary'] as const) {
        test(`a ${role} cannot change branches, hours, procedures, patient fields or the clinic`, async () => {
            const { branch, checkup } = await checkedInVisit();
            const phone = api.clientAs((await provisioned(role)).token);

            const refused: (() => Promise<unknown>)[] = [
                () => phone.branch.create.mutate({ name: 'Elsewhere' }),
                () => phone.branch.update.mutate({ id: branch.id, name: 'Renamed' }),
                () =>
                    phone.settings.setDay.mutate({
                        weekday: 1,
                        branchId: branch.id,
                        opensAt: '09:00',
                        closesAt: '17:00',
                    }),
                () => phone.settings.clearDay.mutate({ weekday: 1 }),
                () => phone.procedure.update.mutate({ id: checkup.id, defaultPrice: 1 }),
                () =>
                    phone.customQuestion.create.mutate({
                        key: 'allergies',
                        label: 'Allergies',
                        kind: 'text',
                    }),
                () => phone.settings.update.mutate({ clinicName: 'Mine now' }),
                () => phone.settings.update.mutate({ requireAge: false }),
            ];
            for (const call of refused) await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, call);
        });
    }

    test('everyone can still set durations and reminders', async () => {
        const doctor = api.clientAs((await provisioned('doctor')).token);
        const updated = await doctor.settings.update.mutate({
            reminderLeadHours: 48,
            askToEditOnFinish: false,
        });
        expect(updated.reminderLeadHours).toBe(48);
    });

    test('the admin, and a phone with no role yet, can set the clinic up', async () => {
        const admin = api.clientAs((await provisioned('admin')).token);
        expect((await admin.settings.update.mutate({ clinicName: 'Lustre' })).clinicName).toBe('Lustre');
        expect((await api.client.settings.update.mutate({ clinicName: 'Legacy' })).clinicName).toBe('Legacy');
    });
});

describe('the join page', () => {
    test('is served without the code, which stays in the fragment', async () => {
        const response = await fetch(`${api.baseUrl}/join`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        const page = await response.text();
        expect(page).toContain('/app/android.apk');
        expect(page).toContain('://join?code=');
        expect(page).toContain('location.hash');
    });
});
