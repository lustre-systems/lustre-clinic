import { describe, expect, it } from 'bun:test';
import type { Appointment, Branch } from './data/types';
import { serverIdentity, takeSchedule, usableSchedule } from './savedSchedule';

const SERVER = 'http://100.64.0.1:3000';

function appointment(over: Partial<Appointment> & Pick<Appointment, 'id' | 'startsAt'>): Appointment {
    return {
        ref: '011026-0001',
        patientId: 'p1',
        branchId: 'b1',
        durationMinutes: 30,
        procedures: [
            {
                id: 'ap1',
                procedureId: 'pr1',
                name: 'Cleaning',
                quantity: 1,
                tooth: null,
                note: null,
                quotedPrice: null,
            },
        ],
        note: null,
        status: 'booked',
        channel: 'phone',
        labStatus: null,
        createdAt: over.startsAt,
        updatedAt: over.startsAt,
        patient: { id: 'p1', ref: 'P-1', name: 'Mona', phone: '01012345678' },
        ...over,
    } as Appointment;
}

const BRANCHES: Branch[] = [{ id: 'b1', name: 'Maadi', address: null, active: true, whatsappApp: 'regular' }];

function take() {
    return takeSchedule({
        server: SERVER,
        savedAt: 1,
        branches: BRANCHES,
        days: [
            {
                date: '2026-10-01',
                appointments: [
                    appointment({ id: 'late', startsAt: '2026-10-01T14:00:00+03:00' }),
                    appointment({ id: 'gone', startsAt: '2026-10-01T10:00:00+03:00', status: 'cancelled' }),
                    appointment({ id: 'early', startsAt: '2026-10-01T09:00:00+03:00', note: 'Bring X-rays' }),
                ],
            },
            { date: '2026-10-02', appointments: [] },
        ],
    });
}

describe('takeSchedule', () => {
    it('keeps the rows the desk will ring, in time order, without the cancelled', () => {
        const [today] = take().days;
        expect(today?.rows.map((row) => row.id)).toEqual(['early', 'late']);
    });

    it('carries the name, number and what the row says under it', () => {
        const [today] = take().days;
        expect(today?.rows[0]).toMatchObject({ name: 'Mona', phone: '01012345678', summary: 'Bring X-rays' });
        expect(today?.rows[1]?.summary).toBe('Cleaning');
    });

    it('keeps branch names and nothing else about them', () => {
        expect(take().branches).toEqual([{ id: 'b1', name: 'Maadi' }]);
    });
});

describe('usableSchedule', () => {
    const raw = JSON.stringify(take());

    it('reads back what was taken', () => {
        expect(usableSchedule(raw, SERVER, '2026-10-01')?.days.map((day) => day.date)).toEqual([
            '2026-10-01',
            '2026-10-02',
        ]);
    });

    it('drops days before today', () => {
        expect(usableSchedule(raw, SERVER, '2026-10-02')?.days.map((day) => day.date)).toEqual([
            '2026-10-02',
        ]);
    });

    it('is nothing once every day has passed', () => {
        expect(usableSchedule(raw, SERVER, '2026-10-03')).toBeNull();
    });

    it('is nothing for another server', () => {
        expect(usableSchedule(raw, 'http://100.64.0.9:3000', '2026-10-01')).toBeNull();
        expect(usableSchedule(raw, null, '2026-10-01')).toBeNull();
    });

    it('is nothing for a value it cannot read', () => {
        expect(usableSchedule(null, SERVER, '2026-10-01')).toBeNull();
        expect(usableSchedule('{not json', SERVER, '2026-10-01')).toBeNull();
        expect(usableSchedule(JSON.stringify({ ...take(), version: 0 }), SERVER, '2026-10-01')).toBeNull();
        expect(usableSchedule(JSON.stringify({ ...take(), days: 'x' }), SERVER, '2026-10-01')).toBeNull();
    });
});

describe('serverIdentity', () => {
    it('prefers the tailnet address', () => {
        expect(serverIdentity({ lan: 'http://192.168.1.5:3000', tailscale: SERVER })).toBe(SERVER);
        expect(serverIdentity({ lan: 'http://192.168.1.5:3000', tailscale: null })).toBe(
            'http://192.168.1.5:3000',
        );
        expect(serverIdentity({ lan: null, tailscale: null })).toBeNull();
    });
});
