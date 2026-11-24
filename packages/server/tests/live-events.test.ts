import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE, WS_EVENT, WS_PROTOCOL_VERSION, type WsFrame } from '@lustre/shared';
import { broadcast } from '../src/ws/index.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { expectTrpcError, startTestServer, type TestServer } from './helpers/trpc.ts';

let api: TestServer;

beforeAll(async () => {
    await setupDatabase();
    api = startTestServer();
});

beforeEach(async () => {
    await truncateAll();
});

afterAll(() => {
    api.stop();
});

type Hello = Extract<WsFrame, { type: 'hello' }>;
type Event = Extract<WsFrame, { type: 'event' }>;

interface Phone {
    hello: Hello;
    replayed: Event[];
    events: Event[];
    close(): void;
}

async function connect(query = ''): Promise<Phone> {
    const ws = new WebSocket(`${api.wsUrl}${query}`);
    const replayed: Event[] = [];
    const events: Event[] = [];

    const hello = await new Promise<Hello>((resolve, reject) => {
        ws.onerror = () => reject(new Error('websocket failed to open'));
        ws.onmessage = (message) => {
            const frame = JSON.parse(String(message.data)) as WsFrame;
            if (frame.type === 'hello') {
                ws.onmessage = (next) => events.push(JSON.parse(String(next.data)) as Event);
                resolve(frame);
            } else {
                replayed.push(frame);
            }
        };
    });

    return { hello, replayed, events, close: () => ws.close() };
}

const settle = () => Bun.sleep(50);

describe('delivery', () => {
    test('every connected phone gets each event once, numbered in order', async () => {
        const desk = await connect();
        const doctor = await connect();

        broadcast(WS_EVENT.VISIT_UPDATED, { id: 'v1' });
        broadcast(WS_EVENT.SETTINGS_UPDATED);
        await settle();

        for (const phone of [desk, doctor]) {
            expect(phone.events.map((frame) => [frame.event, frame.id, frame.seq - phone.hello.seq])).toEqual(
                [
                    [WS_EVENT.VISIT_UPDATED, 'v1', 1],
                    [WS_EVENT.SETTINGS_UPDATED, undefined, 2],
                ],
            );
            expect(phone.events.every((frame) => frame.v === WS_PROTOCOL_VERSION)).toBe(true);
            expect(phone.events.every((frame) => frame.epoch === phone.hello.epoch)).toBe(true);
            phone.close();
        }
    });

    test('a fresh connect is told to refetch, since it cannot know what it missed', async () => {
        const phone = await connect();
        expect(phone.hello).toMatchObject({ v: WS_PROTOCOL_VERSION, type: 'hello', resync: true });
        expect(phone.replayed).toEqual([]);
        phone.close();
    });
});

describe('reconnecting', () => {
    test('replays exactly what was missed, then says hello without a resync', async () => {
        const first = await connect();
        broadcast(WS_EVENT.VISIT_UPDATED, { id: 'seen' });
        await settle();
        const last = first.events.at(-1);
        if (!last) throw new Error('no event arrived');
        first.close();

        broadcast(WS_EVENT.VISIT_COMPLETED, { id: 'missed-1' });
        broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id: 'missed-2' });

        const again = await connect(`?epoch=${last.epoch}&since=${last.seq}`);
        expect(again.replayed.map((frame) => frame.id)).toEqual(['missed-1', 'missed-2']);
        expect(again.replayed.map((frame) => frame.seq)).toEqual([last.seq + 1, last.seq + 2]);
        expect(again.hello).toMatchObject({ resync: false, seq: last.seq + 2 });
        again.close();
    });

    test('a phone that missed nothing gets nothing replayed', async () => {
        const first = await connect();
        first.close();
        const again = await connect(`?epoch=${first.hello.epoch}&since=${first.hello.seq}`);
        expect(again.replayed).toEqual([]);
        expect(again.hello.resync).toBe(false);
        again.close();
    });

    test('a phone from before a server restart is told to refetch', async () => {
        const phone = await connect('?epoch=an-older-process&since=12');
        expect(phone.replayed).toEqual([]);
        expect(phone.hello.resync).toBe(true);
        phone.close();
    });

    test('a phone that missed more than is kept is told to refetch', async () => {
        const first = await connect();
        first.close();
        for (let i = 0; i < 300; i += 1) broadcast(WS_EVENT.REMINDER_UPDATED, { id: `r${i}` });

        const again = await connect(`?epoch=${first.hello.epoch}&since=${first.hello.seq}`);
        expect(again.replayed).toEqual([]);
        expect(again.hello.resync).toBe(true);
        again.close();
    });

    test('a resume point from the future is a resync, not an empty replay', async () => {
        const first = await connect();
        first.close();
        const again = await connect(`?epoch=${first.hello.epoch}&since=${first.hello.seq + 50}`);
        expect(again.hello.resync).toBe(true);
        again.close();
    });
});

describe('the doctor finishing a visit', () => {
    async function checkedIn() {
        const { client } = api;
        const branch = await client.branch.create.mutate({ name: 'Main' });
        const checkup = await client.procedure.create.mutate({
            name: 'Checkup',
            defaultPrice: 100,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: true,
            sortOrder: 0,
        });
        const patient = await client.patient.create.mutate({
            name: 'Nadia Farouk',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });
        const appointment = await client.appointment.create.mutate({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: new Date(Date.now() + 60_000).toISOString(),
            procedures: [{ procedureId: checkup.id, quantity: 1 }],
        });
        const visit = await client.visit.checkIn.mutate({ appointmentId: appointment.id });
        return { appointment, visit };
    }

    test('announces one completion, and a repeated tap announces nothing', async () => {
        const { appointment } = await checkedIn();
        const desk = await connect();

        await api.client.appointment.awaitPayment.mutate({ id: appointment.id });
        await expectTrpcError(ERROR_CODE.INVALID_STATUS_TRANSITION, 422, () =>
            api.client.appointment.awaitPayment.mutate({ id: appointment.id }),
        );
        await settle();

        const completions = desk.events.filter((frame) => frame.event === WS_EVENT.VISIT_COMPLETED);
        expect(completions.map((frame) => frame.id)).toEqual([appointment.id]);
        desk.close();
    });

    test('the desk checking a patient out is not a completion', async () => {
        const { visit } = await checkedIn();
        const desk = await connect();

        await api.client.visit.checkOut.mutate({
            visitId: visit.id,
            chargedTotal: 100,
            paidTotal: 100,
            method: 'cash',
        });
        await settle();

        expect(desk.events.map((frame) => frame.event)).toContain(WS_EVENT.VISIT_UPDATED);
        expect(desk.events.some((frame) => frame.event === WS_EVENT.VISIT_COMPLETED)).toBe(false);
        desk.close();
    });
});

describe('mutations that used to change nothing on the other phone', () => {
    test('patients, reminders and the catalogue each announce themselves', async () => {
        const phone = await connect();
        const { client } = api;

        const branch = await client.branch.create.mutate({ name: 'Main' });
        await client.branch.update.mutate({ id: branch.id, name: 'Downtown' });
        const patient = await client.patient.create.mutate({
            name: 'Nadia Farouk',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });
        await client.patient.update.mutate({ id: patient.id, notes: 'x' });
        await client.procedure.create.mutate({
            name: 'Checkup',
            defaultPrice: 100,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: true,
            sortOrder: 0,
        });
        await settle();

        expect(phone.events.map((frame) => [frame.event, frame.id])).toEqual([
            [WS_EVENT.CATALOG_UPDATED, branch.id],
            [WS_EVENT.CATALOG_UPDATED, branch.id],
            [WS_EVENT.PATIENT_UPDATED, patient.id],
            [WS_EVENT.PATIENT_UPDATED, patient.id],
            [WS_EVENT.CATALOG_UPDATED, expect.any(String)],
        ]);
        phone.close();
    });
});
