import { describe, expect, test } from 'bun:test';
import { PATIENT_REF_PATTERN, REF_PATTERN } from '@lustre/shared';
import { AppError } from '../src/errors/AppError.ts';
import { computeTotal } from '../src/util/money.ts';
import { normalizePhone, toWhatsAppNumber } from '../src/util/phone.ts';
import { buildRef, highestNumericRef } from '../src/util/ref.ts';
import { ageFromBirthDate, dayRange, refDatePart } from '../src/util/time.ts';

describe('normalizePhone', () => {
    test('expands a local Egyptian number to E.164', () => {
        expect(normalizePhone('01012345678')).toBe('+201012345678');
    });

    test('keeps an international number as it is', () => {
        expect(normalizePhone('+201012345678')).toBe('+201012345678');
        expect(normalizePhone('00201012345678')).toBe('+201012345678');
    });

    test('strips formatting', () => {
        expect(normalizePhone(' (010) 1234-5678 ')).toBe('+201012345678');
        expect(normalizePhone('+20 101 234 5678')).toBe('+201012345678');
    });

    test('rejects anything that is not a plausible number', () => {
        for (const bad of ['', 'not a phone', '12', '+', '0100000000000000000']) {
            expect(() => normalizePhone(bad)).toThrow(AppError);
        }
    });

    test('drops the + for a wa.me link', () => {
        expect(toWhatsAppNumber('+201012345678')).toBe('201012345678');
    });
});

describe('computeTotal', () => {
    const checkup = { unitPrice: 30_000, quantity: 1, isCheckup: true };

    test('a lone checkup is charged', () => {
        expect(computeTotal([checkup])).toBe(30_000);
    });

    test('any other line waives the checkup', () => {
        expect(computeTotal([checkup, { unitPrice: 270_000, quantity: 1, isCheckup: false }])).toBe(270_000);
    });

    test('several other lines still waive the checkup', () => {
        expect(
            computeTotal([
                checkup,
                { unitPrice: 420_000, quantity: 1, isCheckup: false },
                { unitPrice: 150_000, quantity: 1, isCheckup: false },
            ]),
        ).toBe(570_000);
    });

    test('multiplies by quantity', () => {
        expect(computeTotal([{ unitPrice: 1_500, quantity: 3, isCheckup: false }])).toBe(4_500);
    });

    test('an empty visit costs nothing', () => {
        expect(computeTotal([])).toBe(0);
    });
});

describe('ageFromBirthDate', () => {
    test('counts whole years', () => {
        expect(ageFromBirthDate('1990-08-03', new Date('2026-08-03T00:00:00Z'))).toBe(36);
    });

    test('does not count a birthday that has not arrived', () => {
        expect(ageFromBirthDate('1990-08-04', new Date('2026-08-03T00:00:00Z'))).toBe(35);
    });

    test('is null without a birth date', () => {
        expect(ageFromBirthDate(null)).toBeNull();
    });
});

describe('dayRange', () => {
    test('covers a UTC day', () => {
        const { from, to } = dayRange('2026-08-03');
        expect(from.toISOString()).toBe('2026-08-03T00:00:00.000Z');
        expect(to.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    });

    test('shifts by the client offset, so the clinic day is the clinic day', () => {
        const { from, to } = dayRange('2026-08-03', 180);
        expect(from.toISOString()).toBe('2026-08-02T21:00:00.000Z');
        expect(to.toISOString()).toBe('2026-08-03T21:00:00.000Z');
    });
});

describe('ref', () => {
    test('is DDMMYY, day first', () => {
        expect(refDatePart(new Date('2026-08-03T09:00:00Z'))).toBe('030826');
    });

    test('matches the shared pattern', () => {
        const ref = buildRef(new Date('2026-08-03T09:00:00Z'));
        expect(ref).toMatch(REF_PATTERN);
        expect(ref.startsWith('030826-')).toBe(true);
    });

    test('excludes the ambiguous characters', () => {
        for (let i = 0; i < 200; i += 1) {
            const suffix = buildRef(new Date()).split('-')[1] ?? '';
            expect(suffix).not.toMatch(/[01OIL]/);
        }
    });
});

describe('patient ref', () => {
    test('is a number, or a code from before numbering', () => {
        for (const ref of ['1', '42', '100245', 'W5F5', '2345']) {
            expect(ref).toMatch(PATIENT_REF_PATTERN);
        }
        for (const ref of ['0', '007', 'W5F', 'W5F5X', '12-3', '']) {
            expect(ref).not.toMatch(PATIENT_REF_PATTERN);
        }
    });

    test('cannot be mistaken for an appointment ref', () => {
        for (const ref of ['1', '130926', 'W5F5']) expect(ref).not.toMatch(REF_PATTERN);
        expect(buildRef(new Date())).not.toMatch(PATIENT_REF_PATTERN);
    });

    test('the highest number taken counts all-digit codes and skips the rest', () => {
        expect(highestNumericRef([])).toBe(0);
        expect(highestNumericRef(['W5F5', 'AB23'])).toBe(0);
        expect(highestNumericRef(['9', '10', 'W5F5'])).toBe(10);
        expect(highestNumericRef(['12', '2345', 'K9M2'])).toBe(2345);
    });
});
