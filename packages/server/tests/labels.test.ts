import { describe, expect, test } from 'bun:test';
import { resolveLabel } from '@lustre/shared';

describe('resolveLabel', () => {
    const both = { label: 'Diabetic?', labelAr: 'هل تعاني من السكري؟' };

    test('gives each viewer their own language', () => {
        expect(resolveLabel(both, 'en')).toBe('Diabetic?');
        expect(resolveLabel(both, 'ar')).toBe('هل تعاني من السكري؟');
    });

    test('falls back to the label that exists', () => {
        expect(resolveLabel({ label: 'Diabetic?', labelAr: null }, 'ar')).toBe('Diabetic?');
        expect(resolveLabel({ label: '', labelAr: 'هل تعاني من السكري؟' }, 'en')).toBe('هل تعاني من السكري؟');
    });

    test('treats a missing translation and a blank one the same', () => {
        expect(resolveLabel({ label: 'Diabetic?' }, 'ar')).toBe('Diabetic?');
        expect(resolveLabel({ label: 'Diabetic?', labelAr: '   ' }, 'ar')).toBe('Diabetic?');
    });

    test('trims what it returns', () => {
        expect(resolveLabel({ label: '  Diabetic?  ', labelAr: null }, 'en')).toBe('Diabetic?');
    });

    test('has nothing to show only when neither side was written', () => {
        expect(resolveLabel({ label: '', labelAr: '' }, 'en')).toBe('');
    });
});
