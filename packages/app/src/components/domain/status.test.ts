import { describe, expect, it } from 'bun:test';
import { type AppointmentStatus, localizeCopy } from '@lustre/shared';
import { statusCopy, statusLabel, statusTone } from './status';

describe('status label', () => {
    it('reads In the chair only for the patient seated', () => {
        expect(statusLabel('checked_in', true)).toBe('In the chair');
        expect(statusTone('checked_in', true)).toBe('accent');
    });

    it('reads Waiting for a patient checked in behind the chair', () => {
        expect(statusLabel('checked_in', false)).toBe('Waiting');
        expect(statusTone('checked_in', false)).toBe('due');
    });

    it('leaves every other status alone whatever the queue says', () => {
        const others: AppointmentStatus[] = ['booked', 'awaiting_payment', 'done', 'cancelled', 'no_show'];
        for (const status of others) {
            expect(statusLabel(status, false)).toBe(statusLabel(status, true));
            expect(statusTone(status, false)).toBe(statusTone(status, true));
        }
        expect(statusLabel('awaiting_payment', false)).toBe('At the desk');
    });

    it('reads Checked in when there is no queue to ask', () => {
        expect(statusLabel('checked_in')).toBe('Checked in');
    });

    it('calls a finished visit Done everywhere', () => {
        expect(statusCopy('done')).toBe('Done');
    });

    it('has Arabic for every word it can say', () => {
        const all: AppointmentStatus[] = [
            'booked',
            'checked_in',
            'awaiting_payment',
            'done',
            'cancelled',
            'no_show',
        ];
        const words = all.flatMap((status) =>
            [true, false, undefined].map((chair) => statusCopy(status, chair)),
        );
        for (const word of new Set(words)) expect(localizeCopy('ar', word)).not.toBe(word);
    });
});
