// The cluster's logic lives in three places — money formatting, answer
// draft↔wire conversion, and patch semantics — and there is no renderer in
// `bun test`, so the components are verified on a device and this covers what
// would fail silently.

import { describe, expect, it } from 'bun:test';
import { setRuntimeLocale } from '../../i18n/runtime';
import {
    displayAnswer,
    fromDraft,
    isAnswered,
    isEditable,
    NO,
    toDraft,
    YES,
} from './components/customFields';
import { clampToOutstanding, formatMoney, isWholePounds, paymentReceipt, toPounds } from './components/money';
import { errorText } from './data/errors';
import { PatientsRequestError } from './data/requestError';
import type { CustomQuestion, Patient } from './data/types';
import type { PatientForm } from './patientForm';

/** The wording, without the isolates `localizeCopy` puts around each value in Arabic. */
const plain = (text: string) => text.replace(/[\u2068\u2069]/g, '');

import {
    answeredCount,
    birthDateOf,
    blankBasics,
    blankOld,
    clearedRequired,
    createInputOf,
    DEFAULT_PATIENT_REQUIREMENTS,
    EMPTY_OLD,
    emptyForm,
    formOf,
    isUnchanged,
    malformedBasics,
    malformedOld,
    missingRequired,
    owesInput,
    owesPiastres,
    prefillOf,
    refBaselineOf,
    refEditError,
    refEditOf,
    refError,
    saveFailureTitle,
    unaskableRequired,
    updateInputOf,
} from './patientForm';

const question = (over: Partial<CustomQuestion> = {}): CustomQuestion => ({
    id: 'q',
    key: 'k',
    label: 'Question',
    labelAr: null,
    kind: 'text',
    options: null,
    required: false,
    sortOrder: 0,
    active: true,
    ...over,
});

const patient = (over: Partial<Patient> = {}): Patient => ({
    id: '11111111-1111-1111-1111-111111111111',
    ref: 'W5F5',
    name: 'Nour El-Sayed',
    phone: '+201002248891',
    email: null,
    birthDate: '1992-03-14',
    gender: 'female',
    custom: {},
    notes: null,
    legacyRef: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    age: 34,
    ...over,
});

/** A form that would be accepted, so a test can break exactly one thing about it. */
const sound = (over: Partial<PatientForm> = {}): PatientForm => ({
    name: 'Nour El-Sayed',
    phone: '0100 224 8891',
    email: '',
    ref: 'W5F5',
    age: '34',
    gender: 'female',
    answers: {},
    notes: '',
    old: EMPTY_OLD,
    ...over,
});

/** The old-patient block, switched on and filled the way the desk would fill it. */
const oldOn = (over: Partial<PatientForm['old']> = {}): PatientForm['old'] => ({
    on: true,
    ref: '710',
    owes: '',
    ...over,
});

const TODAY = '2026-08-17';

describe('money (§7.12, §7.13)', () => {
    it('formats piastres as whole EGP', () => {
        expect(formatMoney(270000)).toBe('EGP 2,700');
        expect(formatMoney(0)).toBe('EGP 0');
        expect(formatMoney(142600000)).toBe('EGP 1,426,000');
    });

    it('never shows piastres', () => {
        expect(formatMoney(260050)).toBe('EGP 2,601');
    });

    it('trails the symbol in Arabic and keeps the numerals Latin', () => {
        expect(formatMoney(260000, { language: 'ar' })).toBe('2,600 ج.م');
    });

    it('rounds a negative amount the same way as its positive twin, and keeps the sign', () => {
        expect(formatMoney(-250)).toBe('EGP -3');
        expect(formatMoney(250)).toBe('EGP 3');
        expect(formatMoney(-40)).toBe('EGP 0');
    });
});

/**
 * The payment sheet's entry rules. Everything else about a payment — how it
 * splits, whether it is allowed — is the server's; this is only what stands
 * between the keypad and the wire.
 */
describe('taking a payment — what the field accepts', () => {
    it('accepts digits and an empty field', () => {
        expect(isWholePounds('6000')).toBe(true);
        expect(isWholePounds('')).toBe(true);
    });

    it('refuses a decimal rather than reinterpreting it', () => {
        expect(isWholePounds('12.50')).toBe(false);
        expect(isWholePounds('12.')).toBe(false);
        expect(isWholePounds('12,50')).toBe(false);
        // Arabic-Indic digits: §7.11 keeps numerals Latin in both languages.
        expect(isWholePounds('١٢')).toBe(false);
        expect(isWholePounds('-5')).toBe(false);
        expect(isWholePounds('1e3')).toBe(false);
    });

    it('would have overcharged a hundredfold under the old strip-the-dot rule', () => {
        const stripped = Number('12.50'.replace(/[^0-9]/g, ''));
        expect(stripped).toBe(1250);
        expect(clampToOutstanding(stripped, 500_000)).toBe(125_000);
        expect(isWholePounds('12.50')).toBe(false);
    });

    it('shows the amount due as the nearer pound', () => {
        expect(toPounds(955_000)).toBe(9_550);
        expect(toPounds(12_050)).toBe(121);
    });

    /**
     * The clamp is against piastres, never the pound figure on screen. An
     * outstanding of 12,050 displays as a due of 121 pounds, and 121 pounds is
     * 50 piastres more than is owed — which `balance.settle` now refuses
     * outright rather than quietly accepting.
     */
    it('never sends more than the real balance, even when the display rounds up', () => {
        expect(clampToOutstanding(121, 12_050)).toBe(12_050);
        expect(clampToOutstanding(60, 955_000)).toBe(6_000);
        expect(clampToOutstanding(9_550, 955_000)).toBe(955_000);
    });

    it('never produces a negative or fractional payment', () => {
        expect(clampToOutstanding(0, 955_000)).toBe(0);
        expect(clampToOutstanding(-10, 955_000)).toBe(0);
        expect(clampToOutstanding(Number.NaN, 955_000)).toBe(0);
        expect(clampToOutstanding(10.7, 955_000)).toBe(1_000);
    });

    // The strip is absent at zero, so the sheet cannot be opened here — this is
    // the belt to that brace, and `balance.settle` refuses it a third time.
    it('allows nothing against a patient who owes nothing', () => {
        expect(clampToOutstanding(500, 0)).toBe(0);
    });
});

/**
 * The paper book is one page per patient, so the desk posts one line against one
 * page: what came in, and what is left. The confirmation says exactly that and
 * names no visits — the per-visit split is the server's bookkeeping and matches
 * nothing anyone is holding.
 */
describe('what a recorded payment says it did', () => {
    it('says what came in and what is still owed', () => {
        expect(plain(paymentReceipt({ amount: 600_000, outstandingAfter: 355_000 }))).toBe(
            'EGP 6,000 recorded — EGP 3,550 still owed',
        );
    });

    // "EGP 0 still owed" is a true sentence nobody wants to read: closing a page
    // is a different mark from writing a balance on it.
    it('says paid in full rather than nothing owed', () => {
        expect(plain(paymentReceipt({ amount: 955_000, outstandingAfter: 0 }))).toBe(
            'EGP 9,550 recorded — paid in full',
        );
    });

    it('names no visit refs at all', () => {
        const line = paymentReceipt({ amount: 600_000, outstandingAfter: 355_000 });
        expect(line).not.toMatch(/\d{6}-/);
    });

    // The line is posted from an event handler, so it reads the locale itself
    // rather than being localized by whatever draws it. The currency goes with
    // it: `EGP` left in an Arabic sentence is an untranslated string like any
    // other, and the catalogue test cannot see a sentence built this way.
    it('reads the locale itself, currency included', () => {
        setRuntimeLocale('ar');
        try {
            expect(plain(paymentReceipt({ amount: 600_000, outstandingAfter: 355_000 }))).toBe(
                'سُجل 6,000 ج.م — وما زال 3,550 ج.م مستحقًا',
            );
            expect(plain(paymentReceipt({ amount: 955_000, outstandingAfter: 0 }))).toBe(
                'سُجل 9,550 ج.م — سُددت بالكامل',
            );
        } finally {
            setRuntimeLocale('en');
        }
    });
});

describe('errors (SPEC §14 — localise from the code, never the message)', () => {
    it('maps a known code to a fixed line and never shows the server text', () => {
        const text = errorText(
            new PatientsRequestError('CUSTOM_QUESTION_REQUIRED', "'blood_type' is required"),
        );
        expect(text).not.toContain('blood_type');
        expect(text).toBe('A required question was left blank.');
    });

    it('falls back for an unknown code and for a transport failure', () => {
        const unknown = errorText(new PatientsRequestError('INTERNAL', 'internal detail', { offline: true }));
        expect(unknown).toBe(errorText(new TypeError('Network request failed')));
        expect(unknown).not.toContain('internal detail');
    });
});

describe('answers', () => {
    it('round-trips each editable kind', () => {
        const text = question({ kind: 'text' });
        expect(fromDraft(text, toDraft(text, 'Penicillin'))).toBe('Penicillin');

        const number = question({ kind: 'number' });
        expect(fromDraft(number, toDraft(number, 68))).toBe(68);

        const boolean = question({ kind: 'boolean' });
        expect(fromDraft(boolean, toDraft(boolean, false))).toBe(false);

        const select = question({ kind: 'select', options: ['O+', 'A+'] });
        expect(fromDraft(select, toDraft(select, 'A+'))).toBe('A+');
    });

    it('sends a cleared answer as the empty string, which the server deletes', () => {
        expect(fromDraft(question(), '   ')).toBe('');
    });

    it('displays every kind, including the ones with no editor', () => {
        expect(displayAnswer(question({ kind: 'boolean' }), true)).toBe('Yes');
        expect(displayAnswer(question({ kind: 'boolean' }), false)).toBe('No');
        expect(displayAnswer(question({ kind: 'date' }), '2025-11-02')).toBe('2025-11-02');
        expect(displayAnswer(question(), '')).toBeNull();
    });

    it('leaves `date` out of the editable kinds until a control exists (§7.9)', () => {
        expect(isEditable(question({ kind: 'date' }))).toBe(false);
        for (const kind of ['text', 'number', 'boolean', 'select'] as const) {
            expect(isEditable(question({ kind }))).toBe(true);
        }
    });

    // The reason a boolean draft is a string. `patient-edit.html` draws Yes/No
    // with neither half filled, and the record counts an absent key as a gap —
    // so "never asked" has to survive a round trip through the editor without
    // becoming "No".
    it('keeps a boolean question that was never asked apart from one answered no', () => {
        const yesno = question({ kind: 'boolean' });

        expect(toDraft(yesno, undefined)).toBe('');
        expect(toDraft(yesno, false)).toBe(NO);
        expect(toDraft(yesno, true)).toBe(YES);

        expect(isAnswered(toDraft(yesno, undefined))).toBe(false);
        expect(isAnswered(toDraft(yesno, false))).toBe(true);
    });

    it('counts a boolean answered no as answered, which is what the editor asks', () => {
        expect(isAnswered(toDraft(question({ kind: 'boolean' }), false))).toBe(true);
        expect(isAnswered(toDraft(question({ kind: 'boolean' }), ''))).toBe(false);
    });
});

describe('the patient form — age is a date of birth (BLOCKED.md)', () => {
    it('turns an age into the 1 January that reads back as it', () => {
        expect(birthDateOf('34', TODAY)).toBe('1992-01-01');
        expect(birthDateOf('0', TODAY)).toBe('2026-01-01');
    });

    it('refuses an age nobody has reached and a blank one', () => {
        expect(birthDateOf('', TODAY)).toBeNull();
        expect(birthDateOf('340', TODAY)).toBeNull();
        expect(malformedBasics(sound({ age: '340' })).age).toBeDefined();
        expect(malformedBasics(sound({ age: '' })).age).toBeUndefined();
    });

    it('reads the age off the record rather than deriving a second one', () => {
        const form = formOf(patient({ age: 41, birthDate: '1985-06-02' }), []);
        expect(form.age).toBe('41');
    });

    // The guard the whole approximation rests on: a record booked in through
    // the day cluster carries a real date of birth, and an editor opened to fix
    // a phone number must not flatten it to 1 January.
    it('never rewrites a real date of birth when the age was not touched', () => {
        const initial = formOf(patient({ age: 34, birthDate: '1992-03-14' }), []);
        const patch = updateInputOf(
            'id',
            { ...initial, phone: '0100 000 0000' },
            initial,
            [],
            DEFAULT_PATIENT_REQUIREMENTS,
            TODAY,
        );

        expect(patch?.phone).toBe('0100 000 0000');
        expect(patch && 'birthDate' in patch).toBe(false);
    });

    it('does send one when the age was corrected, and refuses to save it emptied', () => {
        const initial = formOf(patient({ age: 34 }), []);

        expect(
            updateInputOf('id', { ...initial, age: '35' }, initial, [], DEFAULT_PATIENT_REQUIREMENTS, TODAY)
                ?.birthDate,
        ).toBe('1991-01-01');
        expect(
            updateInputOf('id', { ...initial, age: '' }, initial, [], DEFAULT_PATIENT_REQUIREMENTS, TODAY),
        ).toBeNull();
    });
});

describe('the patient form — what the clinic requires (Settings → Patient fields)', () => {
    const AGE_OFF = { requireAge: false, requireGender: false };
    const BOTH_ON = { requireAge: true, requireGender: true };

    it('by default owes an age and not a sex', () => {
        const form = sound({ age: '', gender: '' });
        expect(blankBasics(form, DEFAULT_PATIENT_REQUIREMENTS)).toEqual(['age']);
        expect(createInputOf(form, [], DEFAULT_PATIENT_REQUIREMENTS, TODAY)).toBeNull();
        expect(
            createInputOf({ ...form, age: '34' }, [], DEFAULT_PATIENT_REQUIREMENTS, TODAY)?.gender,
        ).toBeNull();
    });

    it('with age off, registers someone with no age as no date of birth', () => {
        const form = sound({ age: '' });
        expect(blankBasics(form, AGE_OFF)).toEqual([]);
        expect(createInputOf(form, [], AGE_OFF, TODAY)?.birthDate).toBeNull();
    });

    it('with age off, still refuses an age that is typed and wrong', () => {
        expect(createInputOf(sound({ age: '340' }), [], AGE_OFF, TODAY)).toBeNull();
    });

    it('with age off, lets an edit clear the age, and sends it as none', () => {
        const initial = formOf(patient({ age: 34 }), []);
        expect(
            updateInputOf('id', { ...initial, age: '' }, initial, [], AGE_OFF, TODAY)?.birthDate,
        ).toBeNull();
    });

    it('with sex on, owes a sex until one is chosen', () => {
        const form = sound({ gender: '' });
        expect(blankBasics(form, BOTH_ON)).toEqual(['gender']);
        expect(createInputOf(form, [], BOTH_ON, TODAY)).toBeNull();
        expect(createInputOf({ ...form, gender: 'male' }, [], BOTH_ON, TODAY)?.gender).toBe('male');
    });

    it('with sex on, will not let an edit clear it', () => {
        const initial = formOf(patient({ gender: 'female' }), []);
        expect(updateInputOf('id', { ...initial, gender: '' }, initial, [], BOTH_ON, TODAY)).toBeNull();
    });

    // A record from before the rule was turned on: it reads fine and is only
    // asked for the field when someone edits it.
    it('asks a record already without an age or a sex for them the next time it is edited', () => {
        const initial = formOf(patient({ age: null, birthDate: null, gender: null }), []);
        expect(initial.age).toBe('');

        const fixingPhone = { ...initial, phone: '0100 000 0000' };
        expect(blankBasics(fixingPhone, BOTH_ON)).toEqual(['age', 'gender']);
        expect(updateInputOf('id', fixingPhone, initial, [], BOTH_ON, TODAY)).toBeNull();

        const completed = { ...fixingPhone, age: '40', gender: 'male' };
        expect(updateInputOf('id', completed, initial, [], BOTH_ON, TODAY)).toMatchObject({
            birthDate: '1986-01-01',
            gender: 'male',
        });

        expect(updateInputOf('id', fixingPhone, initial, [], AGE_OFF, TODAY)?.phone).toBe('0100 000 0000');
    });
});

describe('registering from a search that found nobody', () => {
    it('reads digits and the separators a number is written with as a phone', () => {
        expect(prefillOf('01002248891')).toEqual({ phone: '01002248891' });
        expect(prefillOf('  +20 100 224-8891 ')).toEqual({ phone: '+20 100 224-8891' });
    });

    it('reads anything else as a name, trimmed', () => {
        expect(prefillOf('  Nour Hassan ')).toEqual({ name: 'Nour Hassan' });
        expect(prefillOf('نور')).toEqual({ name: 'نور' });
        expect(prefillOf('Nour 2')).toEqual({ name: 'Nour 2' });
    });

    it('does not call separators with no digit in them a number', () => {
        expect(prefillOf('+ -')).toEqual({ name: '+ -' });
    });

    it('offers nothing for a blank term', () => {
        expect(prefillOf('')).toBeNull();
        expect(prefillOf('   ')).toBeNull();
    });

    it('fills only the field the term belongs in', () => {
        const byName = emptyForm([], { name: 'Nour' });
        expect([byName.name, byName.phone]).toEqual(['Nour', '']);
        const byPhone = emptyForm([], { phone: '0100' });
        expect([byPhone.name, byPhone.phone]).toEqual(['', '0100']);
        expect(emptyForm([])).toEqual({ ...byName, name: '' });
    });
});

describe('the patient form — what a save sends', () => {
    const blood = question({ key: 'blood', kind: 'select', options: ['O+', 'A+'], required: true });
    const diabetic = question({ key: 'diabetic', kind: 'boolean' });
    const allergies = question({ key: 'allergies', kind: 'text' });
    const questions = [blood, diabetic, allergies];

    it('counts a blank name, number and age as owed, and says nothing about them', () => {
        const form = emptyForm(questions);
        expect(blankBasics(form, DEFAULT_PATIENT_REQUIREMENTS)).toEqual(['name', 'phone', 'age']);
        expect(malformedBasics(form)).toEqual({});
    });

    it('complains about a number and an address only once they have been typed', () => {
        expect(malformedBasics(sound({ phone: '011' })).phone).toBeDefined();
        expect(malformedBasics(sound({ email: 'nour@' })).email).toBeDefined();
        expect(malformedBasics(sound({ email: '' })).email).toBeUndefined();
    });

    it('refuses to register anyone until every required question is answered', () => {
        const form = sound({ answers: { blood: '', diabetic: '', allergies: '' } });
        expect(missingRequired(form, questions)).toEqual(['blood']);
        expect(createInputOf(form, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY)).toBeNull();

        const answered = { ...form, answers: { ...form.answers, blood: 'O+' } };
        expect(createInputOf(answered, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY)).not.toBeNull();
    });

    it('leaves blank answers out of an intake rather than sending them as empty', () => {
        const form = sound({ answers: { blood: 'O+', diabetic: '', allergies: '' } });
        const input = createInputOf(form, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY);

        expect(input?.custom).toEqual({ blood: 'O+' });
        expect(input?.email).toBeNull();
        expect(input?.birthDate).toBe('1992-01-01');
        expect(input?.gender).toBe('female');
    });

    it('sends only the answers that moved, so a stale option elsewhere cannot block the save', () => {
        const initial = formOf(
            patient({ custom: { blood: 'AB+', diabetic: false, allergies: 'Penicillin' } }),
            questions,
        );
        const form = { ...initial, answers: { ...initial.answers, allergies: 'None known' } };

        const patch = updateInputOf('id', form, initial, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY);
        expect(patch?.custom).toEqual({ allergies: 'None known' });
    });

    // A required question nobody has answered is not the editor's business on an
    // edit: `patient.update` validates the patch alone, and holding an unrelated
    // correction hostage to it is what §7.8 exists to avoid.
    it('does not let an unanswered required question hold an edit back', () => {
        const initial = formOf(patient({ custom: {} }), questions);
        const form = { ...initial, phone: '0100 000 0000' };

        expect(missingRequired(form, questions)).toEqual(['blood']);
        expect(
            updateInputOf('id', form, initial, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY),
        ).not.toBeNull();
    });

    // `validateIntake` wants every *active required* question answered, not just
    // the ones this screen can draw. A required `date` therefore makes intake
    // impossible until it stops being required or gets a control (§7.9) — and
    // the screen has to say so rather than offer a Save that cannot work.
    it('spots a required question it has no control for, so intake fails legibly', () => {
        const asked = question({ key: 'last_visit', kind: 'date', required: true });

        expect(unaskableRequired([blood, diabetic, allergies, asked])).toEqual([asked]);
        expect(unaskableRequired([blood, diabetic, allergies])).toEqual([]);
    });

    it('does not call an optional question it cannot draw a blocker', () => {
        const optional = question({ key: 'last_visit', kind: 'date', required: false });
        expect(unaskableRequired([blood, optional])).toEqual([]);
    });

    // The server draws the line in `checkSubmitted`: a blank for an active
    // required question throws rather than deleting the answer. It only ever
    // sees the keys the patch carries, so "never answered" and "just emptied"
    // are different cases, and only the second one is refused.
    it('refuses to empty a required answer, because the server refuses that patch', () => {
        const initial = formOf(patient({ custom: { blood: 'O+' } }), questions);
        const form = { ...initial, answers: { ...initial.answers, blood: '' } };

        expect(clearedRequired(form, initial, questions)).toEqual(['blood']);
        expect(updateInputOf('id', form, initial, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY)).toBeNull();
    });

    it('does not count a required question that was never answered as emptied', () => {
        const initial = formOf(patient({ custom: {} }), questions);
        const form = { ...initial, phone: '0100 000 0000' };

        expect(clearedRequired(form, initial, questions)).toEqual([]);
        expect(
            updateInputOf('id', form, initial, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY),
        ).not.toBeNull();
    });

    it('lets a required answer be changed, which is not the same as emptied', () => {
        const initial = formOf(patient({ custom: { blood: 'O+' } }), questions);
        const form = { ...initial, answers: { ...initial.answers, blood: 'A+' } };

        expect(clearedRequired(form, initial, questions)).toEqual([]);
        expect(
            updateInputOf('id', form, initial, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY)?.custom,
        ).toEqual({ blood: 'A+' });
    });

    it('sends a cleared answer, and spends no round trip when nothing moved', () => {
        const initial = formOf(patient({ custom: { allergies: 'Penicillin' } }), questions);

        const cleared = updateInputOf(
            'id',
            { ...initial, answers: { ...initial.answers, allergies: '' } },
            initial,
            questions,
            DEFAULT_PATIENT_REQUIREMENTS,
            TODAY,
        );
        expect(cleared?.custom).toEqual({ allergies: '' });

        const untouched = updateInputOf(
            'id',
            initial,
            initial,
            questions,
            DEFAULT_PATIENT_REQUIREMENTS,
            TODAY,
        );
        expect(untouched).not.toBeNull();
        expect(untouched && isUnchanged(untouched)).toBe(true);
    });

    it('counts what the progress bar counts — every question with something in it', () => {
        const form = sound({ answers: { blood: 'O+', diabetic: NO, allergies: '' } });
        expect(answeredCount(form, questions)).toBe(2);
    });
});

/**
 * The **Old patient** switch, and the one rule everything about it turns on:
 * off sends nothing. A number typed and then thought better of must not reach
 * the server, and the way it does not is that `createInputOf` leaves the whole
 * block out rather than sending a blank one.
 */
describe('the Old patient switch', () => {
    const questions: CustomQuestion[] = [];

    it('is off on a blank form, and sends no old block', () => {
        const form = emptyForm(questions);

        expect(form.old.on).toBe(false);
        expect(createInputOf(form, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY)?.old).toBeUndefined();
    });

    it('sends the number on the file as the old ref when it is on', () => {
        const input = createInputOf(
            sound({ old: oldOn({ ref: '710' }) }),
            questions,
            DEFAULT_PATIENT_REQUIREMENTS,
            TODAY,
        );

        expect(input?.old?.ref).toBe('710');
    });

    // The reported case, from the form's side: what the screen sends for old
    // ref 710 has to be 710 and nothing else. The server keeps it as the
    // patient's ref, so a blank or a trimmed-away value here is the bug.
    it('sends 710 for a file marked 710', () => {
        const input = createInputOf(
            sound({ old: oldOn({ ref: ' 710 ' }) }),
            questions,
            DEFAULT_PATIENT_REQUIREMENTS,
            TODAY,
        );

        expect(input?.old?.ref).toBe('710');
    });

    it('sends nothing from the block once the switch goes back off', () => {
        const filled = sound({
            old: oldOn({ ref: '710', owes: '800' }),
        });
        const off = { ...filled, old: { ...filled.old, on: false } };

        // The values are still on screen — a mis-tap that wiped them would be
        // worse — and none of them is in the payload.
        expect(off.old.ref).toBe('710');
        expect(createInputOf(off, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY)?.old).toBeUndefined();
    });

    it('refuses a save while the switch is on and the number is blank', () => {
        const form = sound({ old: oldOn({ ref: '' }) });

        expect(blankOld(form)).toEqual(['ref']);
        expect(createInputOf(form, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY)).toBeNull();
    });

    it('does not count the number as owed while the switch is off', () => {
        expect(blankOld(sound({ old: { ...oldOn({ ref: '' }), on: false } }))).toEqual([]);
    });

    it('takes a number that is not a number — that format is the old system’s', () => {
        const input = createInputOf(
            sound({ old: oldOn({ ref: 'A/1991-07' }) }),
            questions,
            DEFAULT_PATIENT_REQUIREMENTS,
            TODAY,
        );

        expect(input?.old?.ref).toBe('A/1991-07');
    });
});

describe('what an old patient owes', () => {
    const questions: CustomQuestion[] = [];

    it('takes whole pounds and sends integer piastres', () => {
        expect(owesPiastres('800')).toBe(80_000);
        expect(
            createInputOf(
                sound({ old: oldOn({ owes: '800' }) }),
                questions,
                DEFAULT_PATIENT_REQUIREMENTS,
                TODAY,
            )?.old?.openingBalance,
        ).toBe(80_000);
    });

    it('sends nothing at all for a blank or a zero — the absence of a balance is not one', () => {
        expect(owesPiastres('')).toBeNull();
        expect(owesPiastres('0')).toBeNull();

        const blank = createInputOf(
            sound({ old: oldOn({ owes: '' }) }),
            questions,
            DEFAULT_PATIENT_REQUIREMENTS,
            TODAY,
        );
        expect(blank?.old).toBeDefined();
        expect(blank?.old?.openingBalance).toBeUndefined();
    });

    // `12.50` read as `1250` is a hundredfold overcharge told to a patient
    // months later with no visit to check it against. The keypad has no decimal
    // key; a paste is the one way punctuation gets in, and it is refused
    // rather than reinterpreted.
    it('refuses punctuation rather than reading a separator as digits', () => {
        expect(owesInput('12.50')).toBe('12.50');
        expect(owesPiastres('12.50')).toBeNull();
        expect(owesPiastres('1,200')).toBeNull();
        expect(owesPiastres('abc')).toBeNull();

        const pasted = sound({ old: oldOn({ owes: '12.50' }) });
        expect(malformedOld(pasted).owes).toBeDefined();
        expect(createInputOf(pasted, questions, DEFAULT_PATIENT_REQUIREMENTS, TODAY)).toBeNull();
    });

    it('refuses a figure that is a mis-key rather than a balance', () => {
        expect(owesPiastres('100001')).toBeNull();
        expect(malformedOld(sound({ old: oldOn({ owes: '100001' }) })).owes).toBeDefined();
        expect(
            createInputOf(
                sound({ old: oldOn({ owes: '100001' }) }),
                questions,
                DEFAULT_PATIENT_REQUIREMENTS,
                TODAY,
            ),
        ).toBeNull();
    });

    it('says nothing about an amount typed while the switch is off', () => {
        expect(malformedOld(sound({ old: { ...oldOn({ owes: '100001' }), on: false } }))).toEqual({});
    });
});

// Past work is an old visit now, added from the record; registration sends
// only the number and what they owed.
describe('old procedures', () => {
    it('are never part of a registration', () => {
        const input = createInputOf(
            sound({ old: oldOn({ owes: '800' }) }),
            [],
            DEFAULT_PATIENT_REQUIREMENTS,
            TODAY,
        );
        expect(input?.old).toEqual({ ref: '710', openingBalance: 80_000, procedures: [] });
    });
});

/**
 * Correcting the number a record is known by. The screen decides three things
 * — whether the row is drawn, whether what is in it is sound, and whether a
 * save has anything to send — and all three live here.
 */
describe('the ref', () => {
    describe('refError', () => {
        it('takes a plain number', () => {
            for (const ref of ['1', '910', '100000']) expect(refError(ref)).toBeNull();
        });

        // A patient from before numbering carries a four-character code, and it
        // is still the number written on their paper file.
        it('takes the code an older file carries, in either case', () => {
            for (const ref of ['W5F5', 'w5f5', 'ABCD', '2345']) expect(refError(ref)).toBeNull();
        });

        it('trims before it judges', () => {
            expect(refError('  910  ')).toBeNull();
        });

        it('says a record cannot be left without a number', () => {
            expect(refError('')).toBe('A patient keeps their number. Type the one on the file.');
            expect(refError('   ')).toBe('A patient keeps their number. Type the one on the file.');
        });

        it('refuses the ambiguous letters the alphabet leaves out', () => {
            for (const ref of ['W5F0', 'O123', 'WIF5', 'L23A']) expect(refError(ref)).not.toBeNull();
        });

        it('refuses an appointment ref, a leading zero, and the wrong length', () => {
            for (const ref of ['011224-W5F5', '007', 'W5F', 'W5F55', '12 34']) {
                expect(refError(ref)).not.toBeNull();
            }
        });
    });

    describe('refEditOf', () => {
        const from = (ref: string) => sound({ ref });

        it('sends the number when it moved', () => {
            expect(refEditOf(from('910'), from('W5F5'))).toBe('910');
        });

        it('sends nothing when it did not', () => {
            expect(refEditOf(from('W5F5'), from('W5F5'))).toBeNull();
        });

        // The server stores refs uppercase, so retyping the same code in
        // lowercase is not a correction and must not spend a call — or write an
        // audit row saying the number changed when it did not.
        it('sends nothing when only the case differs', () => {
            expect(refEditOf(from('w5f5'), from('W5F5'))).toBeNull();
        });

        it('sends nothing for a ref that is not sound', () => {
            for (const bad of ['', '007', 'W5F0']) {
                expect(refEditOf(from(bad), from('W5F5'))).toBeNull();
            }
        });

        it('trims what it sends', () => {
            expect(refEditOf(from('  910 '), from('W5F5'))).toBe('910');
        });

        // After a partial save the screen compares against the number that
        // landed, not the one the record opened with. Against the opening one,
        // a number the desk changed *again* would still look sent.
        it('compares against the number that already landed', () => {
            const opened = from('W5F5');
            const landed = { ...opened, ref: '910' };

            // Retrying with the landed number: nothing left to send.
            expect(refEditOf(from('910'), landed)).toBeNull();
            // Changed again after it landed: that change is owed.
            expect(refEditOf(from('911'), landed)).toBe('911');
            // Put back to what the record opened with: also a real change.
            expect(refEditOf(from('W5F5'), landed)).toBe('W5F5');
        });

        // The record refetched after somebody else changed the number. The
        // draft still holds the one it opened with, and an unrelated Save must
        // not send that back as a correction.
        it('does not undo a number someone else changed underneath', () => {
            const refreshed = from('777'); // the record's latest read
            const draft = from('W5F5'); // untouched since it was seeded

            const baseline = refBaselineOf(refreshed, 'W5F5', null);
            expect(refEditOf(draft, baseline as PatientForm)).toBeNull();
            // Measured against the refreshed record instead, it would have gone out.
            expect(refEditOf(draft, refreshed)).toBe('W5F5');
        });

        it('takes a number it saved itself over the one it was seeded with', () => {
            expect(refBaselineOf(from('W5F5'), 'W5F5', '910')?.ref).toBe('910');
            expect(refBaselineOf(from('W5F5'), 'W5F5', null)?.ref).toBe('W5F5');
        });

        it('has no baseline until the draft is seeded', () => {
            expect(refBaselineOf(null, null, null)).toBeNull();
            expect(refBaselineOf(from('W5F5'), null, null)).toBeNull();
        });

        // A registration holds no ref: the counter hands the number out.
        it('sends nothing while registering', () => {
            expect(refEditOf(sound({ ref: '' }), sound({ ref: '' }))).toBeNull();
        });
    });

    /**
     * A ref only has to be one this app would issue if it is being changed to.
     * An old patient's number is their old system's, kept verbatim, and Save
     * must not be held hostage to a shape nobody typed today.
     */
    describe('refEditError', () => {
        const on = (ref: string) => sound({ ref });

        it('says nothing about a legacy ref nobody touched', () => {
            for (const legacy of ['A/1991-07', '710/B', '007', 'W5F0']) {
                expect(refEditError(on(legacy), on(legacy))).toBeNull();
            }
        });

        it('ignores a difference that is only case or padding', () => {
            expect(refEditError(on(' a/1991-07 '), on('A/1991-07'))).toBeNull();
        });

        // The lockout this exists to prevent: a record carrying `A/1991-07`
        // must still be editable for everything else.
        it('leaves a legacy record editable', () => {
            const initial = on('A/1991-07');
            const edited = { ...initial, phone: '0100 000 0000' };
            expect(refEditError(edited, initial)).toBeNull();
        });

        it('judges a ref that is being changed', () => {
            expect(refEditError(on('W5F0'), on('W5F5'))).not.toBeNull();
            expect(refEditError(on(''), on('W5F5'))).not.toBeNull();
        });

        it('passes a sound change', () => {
            expect(refEditError(on('910'), on('A/1991-07'))).toBeNull();
        });
    });

    describe('saveFailureTitle', () => {
        it('says partly saved when the number landed and a later call failed', () => {
            expect(saveFailureTitle(false, true)).toBe('The number was saved, the rest was not');
        });

        // An earlier attempt wrote one number; this one tried another and was
        // refused. The number on screen is not on file.
        it('does not claim the number saved when the ref call is the failure', () => {
            expect(saveFailureTitle(true, true)).toBe('Not saved');
        });

        it('says not saved when nothing has landed', () => {
            expect(saveFailureTitle(false, false)).toBe('Not saved');
            expect(saveFailureTitle(true, false)).toBe('Not saved');
        });
    });

    describe('what a refusal says', () => {
        const refusal = (code: string) => errorText(new PatientsRequestError(code as never, 'server text'));

        it('names both shapes when the format is refused', () => {
            expect(refusal('PATIENT_REF_INVALID')).toContain('four-character');
        });

        it('still says a taken number is taken', () => {
            expect(refusal('PATIENT_REF_TAKEN')).toContain('already has that number');
        });
    });

    // `formOf` seeds the editor from the record, so the row opens on the number
    // that is on file rather than empty.
    it('opens on the number the record carries', () => {
        expect(formOf(patient({ ref: '910' }), []).ref).toBe('910');
    });
});

describe('patient notes', () => {
    const id = '11111111-1111-1111-1111-111111111111';

    it('an edit sends the notes, trimmed, only when they moved', () => {
        const initial = formOf(patient({ notes: null }), []);
        expect(
            updateInputOf(
                id,
                { ...initial, notes: '  Prefers mornings \n' },
                initial,
                [],
                DEFAULT_PATIENT_REQUIREMENTS,
            ),
        ).toEqual({
            id,
            notes: 'Prefers mornings',
        });
    });

    it('notes emptied go as null, not an empty string', () => {
        const initial = formOf(patient({ notes: 'Prefers mornings' }), []);
        expect(
            updateInputOf(id, { ...initial, notes: '   ' }, initial, [], DEFAULT_PATIENT_REQUIREMENTS),
        ).toEqual({ id, notes: null });
    });

    it('an edit that does not touch the notes does not send them', () => {
        const initial = formOf(patient({ notes: 'Prefers mornings' }), []);
        const patch = updateInputOf(
            id,
            { ...initial, name: 'Nour Hassan', notes: 'Prefers mornings ' },
            initial,
            [],
            DEFAULT_PATIENT_REQUIREMENTS,
        );
        expect(patch).toEqual({ id, name: 'Nour Hassan' });
    });

    it('a registration carries the notes typed, or null', () => {
        const form = { ...emptyForm([]), name: 'Nour', phone: '01002248891', age: '34' };
        expect(
            createInputOf({ ...form, notes: ' Brother of 4121 ' }, [], DEFAULT_PATIENT_REQUIREMENTS)?.notes,
        ).toBe('Brother of 4121');
        expect(createInputOf(form, [], DEFAULT_PATIENT_REQUIREMENTS)?.notes).toBeNull();
    });
});
