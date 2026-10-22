import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE, grantCodeOf, type Role } from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { branchService } from '../src/modules/branch/branch.service.ts';
import { deviceService } from '../src/modules/device/device.service.ts';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { procedureService } from '../src/modules/procedure/procedure.service.ts';
import { statsService } from '../src/modules/stats/stats.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { clinic as fixtures, ROOT_CANAL_PRICE, todaySlot } from './helpers/factories.ts';
import { expectTrpcError, startTestServer, type TestServer } from './helpers/trpc.ts';

/**
 * The owner's stats screen: profit is revenue less the cost snapshotted on each
 * visit line, split by the branch the visit was booked at. The figures that
 * matter most are the ones that must *not* move — a cost entered after a visit
 * was priced, and visits from before costs existed, both leave past profit
 * alone.
 */

const DAY_MS = 86_400_000;
const ROOT_CANAL_COST = 60_000;

function isoDate(at: Date): string {
    return at.toISOString().slice(0, 10);
}

/** Yesterday through tomorrow: holds `todaySlot()`, which is 00:30 UTC today. */
function around(daysBack = 1) {
    return {
        from: isoDate(new Date(Date.now() - daysBack * DAY_MS)),
        to: isoDate(new Date(Date.now() + DAY_MS)),
        offsetMinutes: 0,
    };
}

/** A root canal booked, checked in and checked out at `chargedTotal`. */
async function rootCanalVisit(
    patientId: string,
    branchId: string,
    procedureId: string,
    chargedTotal = ROOT_CANAL_PRICE,
) {
    const appointment = await appointmentService.create({
        patient: { kind: 'existing', patientId },
        branchId,
        startsAt: todaySlot(),
        offsetMinutes: 0,
        procedures: [{ procedureId, quantity: 1 }],
    });
    const visit = await visitService.checkIn({ appointmentId: appointment.id });
    await visitService.checkOut({ visitId: visit.id, chargedTotal, paidTotal: chargedTotal, method: 'cash' });
    return visit;
}

async function backdate(visitId: string, days: number): Promise<void> {
    await sql`
        UPDATE appointments
        SET starts_at = starts_at - make_interval(days => ${days})
        WHERE id = (SELECT appointment_id FROM visits WHERE id = ${visitId})
    `;
}

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('stats.overview', () => {
    test('profit is revenue less what the lines cost', async () => {
        const clinic = await fixtures();
        await procedureService.update({ id: clinic.rootCanal.id, cost: ROOT_CANAL_COST });

        await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);
        await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id, 250_000);

        const figures = await statsService.overview(around());
        expect(figures.revenue).toBe(ROOT_CANAL_PRICE + 250_000);
        expect(figures.cost).toBe(2 * ROOT_CANAL_COST);
        expect(figures.profit).toBe(ROOT_CANAL_PRICE + 250_000 - 2 * ROOT_CANAL_COST);
    });

    test('a line costs its quantity times the unit cost', async () => {
        const clinic = await fixtures();
        await procedureService.update({ id: clinic.xray.id, cost: 1_000 });

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: clinic.patient.id },
            branchId: clinic.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: clinic.xray.id, quantity: 3 }],
        });
        const visit = await visitService.checkIn({ appointmentId: appointment.id });
        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 15_000,
            paidTotal: 0,
            method: 'cash',
        });

        expect((await statsService.overview(around())).cost).toBe(3_000);
    });

    test('a cost entered after the visit was priced does not rewrite its profit', async () => {
        const clinic = await fixtures();
        await procedureService.update({ id: clinic.rootCanal.id, cost: ROOT_CANAL_COST });
        await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);

        await procedureService.update({ id: clinic.rootCanal.id, cost: 200_000 });

        const figures = await statsService.overview(around());
        expect(figures.cost).toBe(ROOT_CANAL_COST);
    });

    test('editing a visit’s lines keeps the cost each one was priced at', async () => {
        const clinic = await fixtures();
        await procedureService.update({ id: clinic.rootCanal.id, cost: ROOT_CANAL_COST });
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: clinic.patient.id },
            branchId: clinic.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: clinic.rootCanal.id, quantity: 1 }],
        });
        const visit = await visitService.checkIn({ appointmentId: appointment.id });

        await procedureService.update({ id: clinic.rootCanal.id, cost: 200_000 });
        await procedureService.update({ id: clinic.xray.id, cost: 1_000 });
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [
                { procedureId: clinic.rootCanal.id, quantity: 1 },
                { procedureId: clinic.xray.id, quantity: 1 },
            ],
        });

        const lines = await sql<{ procedure_id: string; unit_cost: number }[]>`
            SELECT procedure_id, unit_cost FROM visit_procedures WHERE visit_id = ${visit.id}
        `;
        const costOf = (id: string) => lines.find((line) => line.procedure_id === id)?.unit_cost;
        expect(costOf(clinic.rootCanal.id)).toBe(ROOT_CANAL_COST);
        expect(costOf(clinic.xray.id)).toBe(1_000);
    });

    test('a visit from before costs existed counts as costing nothing', async () => {
        const clinic = await fixtures();
        const visit = await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);
        await procedureService.update({ id: clinic.rootCanal.id, cost: ROOT_CANAL_COST });

        const [line] = await sql<{ unit_cost: number }[]>`
            SELECT unit_cost FROM visit_procedures WHERE visit_id = ${visit.id}
        `;
        expect(line?.unit_cost).toBe(0);

        const figures = await statsService.overview(around());
        expect(figures.cost).toBe(0);
        expect(figures.profit).toBe(ROOT_CANAL_PRICE);
    });

    test('a visit’s charge is counted once however many lines it has', async () => {
        const clinic = await fixtures();
        await procedureService.update({ id: clinic.rootCanal.id, cost: ROOT_CANAL_COST });

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: clinic.patient.id },
            branchId: clinic.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [
                { procedureId: clinic.rootCanal.id, quantity: 1 },
                { procedureId: clinic.xray.id, quantity: 2 },
            ],
        });
        const visit = await visitService.checkIn({ appointmentId: appointment.id });
        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 300_000,
            paidTotal: 0,
            method: 'cash',
        });

        const figures = await statsService.overview(around());
        expect(figures.revenue).toBe(300_000);
        expect(figures.cost).toBe(ROOT_CANAL_COST);
    });

    test('opening balances and imported visits are not this clinic’s work', async () => {
        const clinic = await fixtures();
        const opening = await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);
        const imported = await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);
        await sql`UPDATE appointments SET is_opening_balance = true
                  WHERE id = (SELECT appointment_id FROM visits WHERE id = ${opening.id})`;
        await sql`UPDATE appointments SET is_imported = true
                  WHERE id = (SELECT appointment_id FROM visits WHERE id = ${imported.id})`;

        const figures = await statsService.overview(around());
        expect(figures.revenue).toBe(0);
        expect(figures.branches).toEqual([]);
    });

    test('new patients leave out the ones imported from the old system', async () => {
        await fixtures();
        const imported = await patientService.create({
            name: 'Old Patient',
            phone: '01099999999',
            birthDate: '1980-01-01',
            custom: {},
        });
        await sql`UPDATE patients SET legacy_ref = 'A-1' WHERE id = ${imported.id}`;

        expect((await statsService.overview(around())).newPatients).toBe(1);
    });

    test('splits profit by branch and counts the days each one saw a visit', async () => {
        const clinic = await fixtures();
        const second = await branchService.create({ name: 'Zamalek' });
        await procedureService.update({ id: clinic.rootCanal.id, cost: ROOT_CANAL_COST });

        await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);
        const earlier = await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);
        await backdate(earlier.id, 1);
        await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);
        await rootCanalVisit(clinic.patient.id, second.id, clinic.rootCanal.id, 100_000);

        const figures = await statsService.overview(around(2));
        const main = figures.branches.find((row) => row.branchId === clinic.branch.id);
        const zamalek = figures.branches.find((row) => row.branchId === second.id);

        expect(main?.workingDays).toBe(2);
        expect(main?.profit).toBe(3 * (ROOT_CANAL_PRICE - ROOT_CANAL_COST));
        expect(zamalek?.workingDays).toBe(1);
        expect(zamalek?.profit).toBe(100_000 - ROOT_CANAL_COST);
        expect(figures.profit).toBe((main?.profit ?? 0) + (zamalek?.profit ?? 0));
    });
});

describe('stats.trend', () => {
    test('answers each period in the order asked', async () => {
        const clinic = await fixtures();
        const earlier = await rootCanalVisit(
            clinic.patient.id,
            clinic.branch.id,
            clinic.rootCanal.id,
            100_000,
        );
        await backdate(earlier.id, 10);
        await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id, 200_000);

        const day = (back: number) => isoDate(new Date(Date.now() - back * DAY_MS));
        const points = await statsService.trend([
            { from: day(10), to: day(10), offsetMinutes: 0 },
            { from: day(9), to: day(1), offsetMinutes: 0 },
            { from: day(0), to: day(0), offsetMinutes: 0 },
        ]);

        expect(points.map((point) => point.revenue)).toEqual([100_000, 0, 200_000]);
    });
});

describe('a range narrowed to minutes of its day', () => {
    test('counts a visit only inside the hour it fell in', async () => {
        const clinic = await fixtures();
        // `todaySlot()` is 00:30 UTC today.
        await rootCanalVisit(clinic.patient.id, clinic.branch.id, clinic.rootCanal.id);
        const today = isoDate(new Date());
        const hour = (h: number) => ({
            from: today,
            to: today,
            offsetMinutes: 0,
            fromMinute: h * 60,
            toMinute: (h + 1) * 60,
        });

        const [first, second] = await statsService.trend([hour(0), hour(1)]);
        expect(first?.revenue).toBe(ROOT_CANAL_PRICE);
        expect(second?.revenue).toBe(0);
    });
});

describe('who may see the stats', () => {
    let api: TestServer;

    beforeAll(() => {
        api = startTestServer();
    });

    afterAll(() => {
        api.stop();
    });

    async function phoneAs(role: Role) {
        const grant = await deviceService.issue({ role, label: role }, null);
        const code = grantCodeOf(grant.payload);
        if (!code) throw new Error('issued payload is not a grant');
        const { token } = await api.client.device.redeem.mutate({ code });
        return api.clientAs(token);
    }

    const range = { from: '2026-01-01', to: '2026-12-31' };

    for (const role of ['secretary', 'doctor'] as const) {
        test(`a ${role} is refused the clinic’s figures`, async () => {
            const phone = await phoneAs(role);
            const refused: (() => Promise<unknown>)[] = [
                () => phone.stats.overview.query(range),
                () => phone.stats.trend.query({ periods: [range] }),
                () => phone.stats.summary.query(range),
                () => phone.balance.summary.query(range),
                () => phone.balance.takings.query(range),
            ];
            for (const call of refused) await expectTrpcError(ERROR_CODE.ROLE_FORBIDDEN, 403, call);
        });
    }

    test('the secretary still gets who owes', async () => {
        const phone = await phoneAs('secretary');
        expect((await phone.balance.outstanding.query()).total).toBe(0);
    });

    test('an admin and a phone with no role see them', async () => {
        const admin = await phoneAs('admin');
        expect((await admin.stats.overview.query(range)).revenue).toBe(0);
        expect(await admin.stats.trend.query({ periods: [range, range] })).toHaveLength(2);
        expect((await api.client.stats.overview.query(range)).revenue).toBe(0);
    });

    test('what a procedure costs is hidden from anyone who may not see the stats', async () => {
        const clinic = await fixtures();
        await procedureService.update({ id: clinic.rootCanal.id, cost: ROOT_CANAL_COST });

        const costOf = (rows: { id: string; cost: number | null }[]) =>
            rows.find((row) => row.id === clinic.rootCanal.id)?.cost;

        const secretary = await phoneAs('secretary');
        const admin = await phoneAs('admin');
        expect(costOf(await secretary.procedure.list.query())).toBeNull();
        expect(costOf(await admin.procedure.list.query())).toBe(ROOT_CANAL_COST);

        const tree = await secretary.procedure.tree.query({ includeInactive: false });
        expect(tree.every((node) => node.cost === null)).toBe(true);
    });
});
