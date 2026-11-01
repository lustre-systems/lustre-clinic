// The field-level rules three clusters share. `day.test.ts`, `patients.test.ts`
// and `entryForm.test.ts` each cover their own submission shape on top of these;
// what is here is the rules themselves, at their edges.
//
// Pure logic, no renderer: the components beside it import `react-native`, which
// fails outside Metro, so the rules live here and are tested here.
import { describe, expect, test } from 'bun:test';
import {
    ageError,
    birthDateError,
    birthDateIso,
    birthDateOf,
    calendarIsoOf,
    emailError,
    GENDERS,
    orNull,
    phoneError,
} from './patientDraft';

const TODAY = '2026-08-16';

describe('phoneError', () => {
    test('an untouched field is not an error', () => {
        expect(phoneError('')).toBeNull();
        expect(phoneError('   ')).toBeNull();
    });

    test('separators do not count towards the length', () => {
        expect(phoneError('+20 101 234 5678')).toBeNull();
        expect(phoneError('0100 224 8891')).toBeNull();
    });

    // The regression this file was started for: judging "answered" on the
    // stripped string reads a lone `+` as an untouched field and lets it reach
    // the server, where only `.min(5)` is left to catch it.
    test('a field holding only separators is too short, not unanswered', () => {
        expect(phoneError('+')).not.toBeNull();
        expect(phoneError('+ ')).not.toBeNull();
        expect(phoneError('  +  ')).not.toBeNull();
    });

    test('a number too short to be one is refused', () => {
        expect(phoneError('011')).not.toBeNull();
        expect(phoneError('1 2 3')).not.toBeNull();
        expect(phoneError('01012345678')).toBeNull();
    });
});

describe('emailError', () => {
    test('blank is not an error, malformed is', () => {
        expect(emailError('')).toBeNull();
        expect(emailError('  ')).toBeNull();
        expect(emailError('nadia@example.com')).toBeNull();
        expect(emailError('nadia@example')).not.toBeNull();
        expect(emailError('nadia.example.com')).not.toBeNull();
    });
});

describe('the age, converted', () => {
    // The app's one lossy rule: the year is what the desk was told, the day is
    // not. 1 January reads back as the same age for the rest of the year.
    test('an age becomes 1 January of the year that reads back as it', () => {
        const today = '2026-08-16';
        expect(birthDateOf('34', today)).toBe('1992-01-01');
        expect(birthDateOf('0', today)).toBe('2026-01-01');
    });

    test('a blank age is no date rather than a bad one', () => {
        expect(birthDateOf('', '2026-08-16')).toBeNull();
        expect(ageError('')).toBeNull();
    });

    test('nobody is 340', () => {
        expect(birthDateOf('340', '2026-08-16')).toBeNull();
        expect(ageError('340')).not.toBeNull();
    });
});

describe('the date of birth, typed', () => {
    test('takes a whole, real, past date', () => {
        expect(birthDateIso('05111990', TODAY)).toBe('1990-11-05');
        expect(birthDateIso('29022024', TODAY)).toBe('2024-02-29');
        expect(birthDateIso('16082026', TODAY)).toBe('2026-08-16');
    });

    test('refuses one that is impossible, too early, or not yet', () => {
        expect(birthDateIso('29022023', TODAY)).toBeNull();
        expect(birthDateIso('32011990', TODAY)).toBeNull();
        expect(birthDateIso('05131990', TODAY)).toBeNull();
        expect(birthDateIso('05111899', TODAY)).toBeNull();
        expect(birthDateIso('17082026', TODAY)).toBeNull();
    });

    test('says nothing until there is something to correct', () => {
        expect(birthDateError('', TODAY)).toBeNull();
        expect(birthDateError('0511', TODAY)).not.toBeNull();
        expect(birthDateError('05111990', TODAY)).toBeNull();
    });
});

describe('orNull', () => {
    test('blank is the question left unanswered, not an empty string', () => {
        expect(orNull('')).toBeNull();
        expect(orNull('   ')).toBeNull();
        expect(orNull('  Nadia  ')).toBe('Nadia');
    });
});

describe('calendarIsoOf', () => {
    test('reads DDMMYYYY into a date the calendar has', () => {
        expect(calendarIsoOf('29022024')).toBe('2024-02-29');
        expect(calendarIsoOf('29022023')).toBeNull();
    });

    // `Number('aa')` is NaN and passes every range check, so the shape is checked first.
    test('refuses anything that is not eight digits', () => {
        for (const bad of [
            'aa012020',
            '01aa2020',
            '0101abcd',
            '1.012020',
            ' 1012020',
            '0101202',
            '010120201',
        ]) {
            expect(calendarIsoOf(bad)).toBeNull();
        }
    });
});

describe('GENDERS', () => {
    test('offers the way back out of a mis-tap, stored lowercase', () => {
        expect(GENDERS.map((option) => option.value)).toEqual(['', 'female', 'male']);
    });
});
