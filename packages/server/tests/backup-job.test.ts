import { describe, expect, test } from 'bun:test';
import { isBackupDue } from '../src/background/backup.job.ts';

const HOUR = 3_600_000;
const INTERVAL = 24 * HOUR;
const NOW = Date.parse('2026-09-13T12:00:00Z');

describe('isBackupDue', () => {
    test('is due when no backup has ever succeeded', () => {
        expect(isBackupDue(null, NOW, INTERVAL)).toBe(true);
    });

    test('is not due when the last success is recent', () => {
        expect(isBackupDue(new Date(NOW - 3 * HOUR).toISOString(), NOW, INTERVAL)).toBe(false);
    });

    test('is due when the last success is older than the interval', () => {
        expect(isBackupDue(new Date(NOW - 30 * HOUR).toISOString(), NOW, INTERVAL)).toBe(true);
    });

    test('is due exactly one interval after the last success', () => {
        expect(isBackupDue(new Date(NOW - INTERVAL).toISOString(), NOW, INTERVAL)).toBe(true);
    });

    test('is due when the marker holds an unreadable date, rather than never', () => {
        expect(isBackupDue('not a date', NOW, INTERVAL)).toBe(true);
    });
});
