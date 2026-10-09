import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE, MAX_PATIENT_REF, PATIENT_REF_PATTERN, renderReminderTemplate } from '@lustre/shared';
import { AppError } from '../src/errors/AppError.ts';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { balanceService } from '../src/modules/balance/balance.service.ts';
import { branchService } from '../src/modules/branch/branch.service.ts';
import { createCustomQuestionInput } from '../src/modules/customQuestion/customQuestion.schema.ts';
import { customQuestionService } from '../src/modules/customQuestion/customQuestion.service.ts';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { procedureService } from '../src/modules/procedure/procedure.service.ts';
import { reminderService } from '../src/modules/reminder/reminder.service.ts';
import { setClinicDayInput, updateSettingsInput } from '../src/modules/settings/settings.schema.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { statsService } from '../src/modules/stats/stats.service.ts';
import { setProceduresInput } from '../src/modules/visit/visit.schema.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { clinicDayOf } from '../src/util/time.ts';
import { setupDatabase, sql, truncateAll, uuid } from './helpers/db.ts';
import {
    CHECKUP_PRICE,
    checkedInVisit,
    EXTRACTION_PRICE,
    expectAppError,
    clinic as fixtures,
    ROOT_CANAL_PRICE,
    slot,
    todaySlot,
} from './helpers/factories.ts';

/**
 * Phase 1 modules against a real Postgres. The rules worth asserting are the
 * ones the schema cannot hold on its own: the checkup waiver (§9), one level of
 * procedure nesting (§5), status transitions (§7), and balances being derived
 * rather than stored (§10).
 *
 * Key invariants: a weekday with no row is closed; a category with no bookable
 * children is bookable by nobody; `missed` is `booked` past its end and nothing
 * transitions on a timer; the status check and write are one statement, so a
 * concurrent move is refused rather than silently overwritten; an explicit
 * `charged_total` is the clinic's discount and survives recompute (and is never
 * re-edited after checkout, where §10's `recordPayment` takes over); the
 * questionnaire moves while records stay, so patches never touch answers the
 * caller did not submit.
 */

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('settings', () => {
    test('seeds a single row on first read', async () => {
        const settings = await settingsService.get();

        expect(settings.clinicName).toBeString();
        expect(settings.durationOptions.length).toBeGreaterThan(0);
        expect(settings.durationOptions).toContain(settings.defaultDuration);
    });

    test('is idempotent — reading twice does not create a second row', async () => {
        await settingsService.get();
        await settingsService.ensureSeeded();
        const settings = await settingsService.get();

        expect(settings.clinicName).toBeString();
    });

    test('updates and sorts duration options', async () => {
        const updated = await settingsService.update({ durationOptions: [45, 15, 30], defaultDuration: 15 });

        expect(updated.durationOptions).toEqual([15, 30, 45]);
        expect(updated.defaultDuration).toBe(15);
    });

    test('refuses a default duration outside the options', async () => {
        await expectAppError(ERROR_CODE.INVALID_DURATION, () =>
            settingsService.update({ durationOptions: [30], defaultDuration: 20 }),
        );
    });

    test('returns the notification time as HH:MM', async () => {
        const updated = await settingsService.update({ reminderNotifyAt: '18:30' });
        expect(updated.reminderNotifyAt).toBe('18:30');
    });
});

/**
 * A weekday with no row is closed — the day view renders it as closed rather
 * than as an empty schedule, so absence is the meaningful case here.
 */
describe('clinic days', () => {
    test('an unset weekday is closed', async () => {
        expect(await settingsService.schedule()).toEqual([]);
        expect(await settingsService.dayFor(1)).toBeNull();
    });

    test('sets a weekday and returns hours as HH:MM', async () => {
        const { branch } = await fixtures();

        const day = await settingsService.setDay({
            weekday: 1,
            branchId: branch.id,
            opensAt: '10:00',
            closesAt: '18:00',
        });

        expect(day).toEqual({ weekday: 1, branchId: branch.id, opensAt: '10:00', closesAt: '18:00' });
        expect(await settingsService.dayFor(1)).toEqual(day);
    });

    test('setting the same weekday twice replaces it rather than adding a second branch', async () => {
        const { branch } = await fixtures();
        const other = await branchService.create({ name: 'Second' });

        await settingsService.setDay({
            weekday: 2,
            branchId: branch.id,
            opensAt: '10:00',
            closesAt: '18:00',
        });
        await settingsService.setDay({
            weekday: 2,
            branchId: other.id,
            opensAt: '12:00',
            closesAt: '20:00',
        });

        const schedule = await settingsService.schedule();
        expect(schedule).toEqual([{ weekday: 2, branchId: other.id, opensAt: '12:00', closesAt: '20:00' }]);
    });

    test('lists open weekdays in order', async () => {
        const { branch } = await fixtures();
        for (const weekday of [4, 0, 2]) {
            await settingsService.setDay({
                weekday,
                branchId: branch.id,
                opensAt: '10:00',
                closesAt: '18:00',
            });
        }

        expect((await settingsService.schedule()).map((d) => d.weekday)).toEqual([0, 2, 4]);
    });

    test('clearing a weekday closes it, and clearing a closed day is a no-op', async () => {
        const { branch } = await fixtures();
        await settingsService.setDay({
            weekday: 3,
            branchId: branch.id,
            opensAt: '10:00',
            closesAt: '18:00',
        });

        await settingsService.clearDay(3);
        await settingsService.clearDay(3);

        expect(await settingsService.dayFor(3)).toBeNull();
        expect(await settingsService.schedule()).toEqual([]);
    });

    test('refuses a branch that does not exist', async () => {
        await expectAppError(ERROR_CODE.NOT_FOUND, () =>
            settingsService.setDay({
                weekday: 1,
                branchId: Bun.randomUUIDv7(),
                opensAt: '10:00',
                closesAt: '18:00',
            }),
        );
    });

    test('rejects closing before opening', () => {
        const result = setClinicDayInput.safeParse({
            weekday: 1,
            branchId: Bun.randomUUIDv7(),
            opensAt: '18:00',
            closesAt: '10:00',
        });

        expect(result.success).toBe(false);
    });

    test('rejects a time carrying seconds, which would not survive the round trip', () => {
        const result = setClinicDayInput.safeParse({
            weekday: 1,
            branchId: Bun.randomUUIDv7(),
            opensAt: '10:00:15',
            closesAt: '18:00',
        });

        expect(result.success).toBe(false);
    });

    test('rejects a weekday outside 0–6', () => {
        const branchId = Bun.randomUUIDv7();
        const hours = { opensAt: '10:00', closesAt: '18:00' };

        expect(setClinicDayInput.safeParse({ weekday: 7, branchId, ...hours }).success).toBe(false);
        expect(setClinicDayInput.safeParse({ weekday: -1, branchId, ...hours }).success).toBe(false);
    });
});

describe('procedure', () => {
    test('nests one level and marks categories unselectable', async () => {
        const category = await procedureService.create({
            name: 'Endodontics',
            defaultPrice: 0,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 0,
        });
        await procedureService.create({
            parentId: category.id,
            name: 'Root canal',
            defaultPrice: ROOT_CANAL_PRICE,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 0,
        });

        const tree = await procedureService.tree();
        const root = tree.find((n) => n.id === category.id);

        expect(root?.children.length).toBe(1);
        expect(root?.selectable).toBe(false);
    });

    test('a childless root is itself selectable', async () => {
        const solo = await procedureService.create({
            name: 'Checkup',
            defaultPrice: CHECKUP_PRICE,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: true,
            sortOrder: 0,
        });

        const tree = await procedureService.tree();
        expect(tree.find((n) => n.id === solo.id)?.selectable).toBe(true);
        expect(await procedureService.requireSelectable(solo.id)).toBeTruthy();
    });

    test('refuses a third level', async () => {
        const category = await procedureService.create({
            name: 'Endodontics',
            defaultPrice: 0,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 0,
        });
        const child = await procedureService.create({
            parentId: category.id,
            name: 'Root canal',
            defaultPrice: ROOT_CANAL_PRICE,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 0,
        });

        await expectAppError(ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP, () =>
            procedureService.create({
                parentId: child.id,
                name: 'Molar',
                defaultPrice: 1,
                hasQuantity: false,
                isToothSpecific: false,
                isCheckup: false,
                sortOrder: 0,
            }),
        );
    });

    test('refuses to put a procedure on a visit when it is a category', async () => {
        const category = await procedureService.create({
            name: 'Endodontics',
            defaultPrice: 0,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 0,
        });
        await procedureService.create({
            parentId: category.id,
            name: 'Root canal',
            defaultPrice: ROOT_CANAL_PRICE,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 0,
        });

        await expectAppError(ERROR_CODE.PROCEDURE_NOT_SELECTABLE, () =>
            procedureService.requireSelectable(category.id),
        );
    });

    test('deactivating a subtype does not make its category selectable', async () => {
        const category = await procedureService.create({
            name: 'Endodontics',
            defaultPrice: 0,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 0,
        });
        const child = await procedureService.create({
            parentId: category.id,
            name: 'Root canal',
            defaultPrice: ROOT_CANAL_PRICE,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 0,
        });
        expect((await procedureService.selectableList()).map((p) => p.id)).toEqual([child.id]);

        await procedureService.update({ id: child.id, active: false });

        const selectable = await procedureService.selectableList();
        expect(selectable.map((p) => p.id)).not.toContain(child.id);
        expect(selectable.map((p) => p.id)).not.toContain(category.id);

        const root = (await procedureService.tree()).find((n) => n.id === category.id);
        expect(root?.selectable).toBe(false);
    });

    describe('createCategory', () => {
        test('writes the heading and its first subtype together', async () => {
            const { category, first } = await procedureService.createCategory({
                name: 'Crowns',
                sortOrder: 0,
                first: {
                    name: 'Zirconia',
                    defaultPrice: ROOT_CANAL_PRICE,
                    hasQuantity: false,
                    isToothSpecific: true,
                    isCheckup: false,
                },
            });

            expect(category.defaultPrice).toBe(0);
            expect(first.parentId).toBe(category.id);

            const tree = await procedureService.tree();
            const root = tree.find((n) => n.id === category.id);
            expect(root?.selectable).toBe(false);
            expect(root?.children.map((c) => c.id)).toEqual([first.id]);

            // The heading is never bookable, the subtype always is.
            expect((await procedureService.selectableList()).map((p) => p.id)).toEqual([first.id]);
        });

        // Without the transaction the heading survives a failed subtype, and a
        // childless root priced 0 is a procedure `list` offers on a visit.
        test('writes neither when the subtype cannot be written', async () => {
            await expect(
                procedureService.createCategory({
                    name: 'Crowns',
                    sortOrder: 0,
                    first: {
                        // Past int4 — Postgres refuses it after the heading is in.
                        defaultPrice: Number.MAX_SAFE_INTEGER,
                        name: 'Zirconia',
                        hasQuantity: false,
                        isToothSpecific: false,
                        isCheckup: false,
                    },
                }),
            ).rejects.toThrow();

            expect(await procedureService.tree({ includeInactive: true })).toEqual([]);
        });
    });

    // The pane says "only one procedure can hold it", and the waiver (§9) has to
    // know which line it is waiving.
    test('the checkup flag is handed over, never shared', async () => {
        const first = await procedureService.create({
            name: 'Checkup',
            defaultPrice: CHECKUP_PRICE,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: true,
            sortOrder: 0,
        });

        const second = await procedureService.create({
            name: 'Consultation',
            defaultPrice: CHECKUP_PRICE,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: true,
            sortOrder: 1,
        });

        expect((await procedureService.byId(first.id)).isCheckup).toBe(false);
        expect(await procedureService.findCheckup()).toMatchObject({ id: second.id });

        const back = await procedureService.update({ id: first.id, isCheckup: true });
        expect(back.isCheckup).toBe(true);
        expect((await procedureService.byId(second.id)).isCheckup).toBe(false);
    });

    describe('reorder', () => {
        async function threeRoots() {
            const names = ['Checkup', 'Extraction', 'Scaling'];
            const rows = [];
            for (const [index, name] of names.entries()) {
                rows.push(
                    await procedureService.create({
                        name,
                        defaultPrice: CHECKUP_PRICE,
                        hasQuantity: false,
                        isToothSpecific: false,
                        isCheckup: false,
                        sortOrder: index,
                    }),
                );
            }
            return rows;
        }

        test('applies the whole order in one write', async () => {
            const [first, second, third] = await threeRoots();
            if (!first || !second || !third) throw new Error('fixture');

            await procedureService.reorder({ ids: [third.id, first.id, second.id] });

            const tree = await procedureService.tree();
            expect(tree.map((n) => n.id)).toEqual([third.id, first.id, second.id]);
        });

        // The point of the procedure: a list naming a row that is not there
        // leaves the old order intact rather than applying the first half.
        test('leaves the order untouched when one id does not exist', async () => {
            const [first, second, third] = await threeRoots();
            if (!first || !second || !third) throw new Error('fixture');

            await expectAppError(ERROR_CODE.NOT_FOUND, () =>
                procedureService.reorder({ ids: [third.id, second.id, crypto.randomUUID()] }),
            );

            const tree = await procedureService.tree();
            expect(tree.map((n) => n.id)).toEqual([first.id, second.id, third.id]);
        });

        test('refuses a list spanning two categories, and one naming a row twice', async () => {
            const [root] = await threeRoots();
            if (!root) throw new Error('fixture');

            const category = await procedureService.create({
                name: 'Endodontics',
                defaultPrice: 0,
                hasQuantity: false,
                isToothSpecific: false,
                isCheckup: false,
                sortOrder: 0,
            });
            const child = await procedureService.create({
                parentId: category.id,
                name: 'Root canal',
                defaultPrice: ROOT_CANAL_PRICE,
                hasQuantity: false,
                isToothSpecific: false,
                isCheckup: false,
                sortOrder: 0,
            });

            await expectAppError(ERROR_CODE.VALIDATION, () =>
                procedureService.reorder({ ids: [root.id, child.id] }),
            );
            await expectAppError(ERROR_CODE.VALIDATION, () =>
                procedureService.reorder({ ids: [root.id, root.id] }),
            );
        });
    });
});

describe('customQuestion', () => {
    // §14. The question is bilingual; the answer is not.
    test('keeps both labels, and stores an unwritten Arabic one as null', async () => {
        const bilingual = await customQuestionService.create({
            key: 'diabetic',
            label: 'Diabetic?',
            labelAr: 'هل تعاني من السكري؟',
            kind: 'boolean',
            required: false,
            sortOrder: 0,
        });
        expect(bilingual.labelAr).toBe('هل تعاني من السكري؟');

        // What the editor sends for an input nobody filled in has to land as
        // NULL, or the fallback in `resolveLabel` never fires for that row.
        const blank = createCustomQuestionInput.parse({
            key: 'allergies',
            label: 'Allergies',
            labelAr: '   ',
            kind: 'text',
        });
        expect(blank.labelAr).toBeNull();

        const stored = await customQuestionService.create(blank);
        expect(stored.labelAr).toBeNull();

        // A translation added later, and one cleared again.
        const translated = await customQuestionService.update({
            id: stored.id,
            labelAr: 'الحساسية',
        });
        expect(translated.labelAr).toBe('الحساسية');
        expect(translated.label).toBe('Allergies');

        const cleared = await customQuestionService.update({ id: stored.id, labelAr: null });
        expect(cleared.labelAr).toBeNull();
    });

    test('leaves the Arabic label alone when an edit does not mention it', async () => {
        const question = await customQuestionService.create({
            key: 'referral',
            label: 'How did you hear about us?',
            labelAr: 'كيف سمعت عنا؟',
            kind: 'text',
            required: false,
            sortOrder: 0,
        });

        const renamed = await customQuestionService.update({ id: question.id, required: true });
        expect(renamed.labelAr).toBe('كيف سمعت عنا؟');
    });

    test('rejects a duplicate key', async () => {
        await customQuestionService.create({
            key: 'allergies',
            label: 'Allergies',
            kind: 'text',
            required: false,
            sortOrder: 0,
        });

        await expectAppError(ERROR_CODE.DUPLICATE_KEY, () =>
            customQuestionService.create({
                key: 'allergies',
                label: 'Allergies again',
                kind: 'text',
                required: false,
                sortOrder: 0,
            }),
        );
    });

    describe('reorder', () => {
        async function threeQuestions() {
            const keys = ['diabetic', 'blood_thinners', 'allergies'];
            const rows = [];
            for (const [index, key] of keys.entries()) {
                rows.push(
                    await customQuestionService.create({
                        key,
                        label: key,
                        kind: 'text',
                        required: false,
                        sortOrder: index,
                    }),
                );
            }
            return rows;
        }

        test('applies the whole order in one write', async () => {
            const [first, second, third] = await threeQuestions();
            if (!first || !second || !third) throw new Error('fixture');

            await customQuestionService.reorder({ ids: [third.id, first.id, second.id] });

            const rows = await customQuestionService.list();
            expect(rows.map((q) => q.id)).toEqual([third.id, first.id, second.id]);
        });

        test('leaves the order untouched when one id does not exist', async () => {
            const [first, second, third] = await threeQuestions();
            if (!first || !second || !third) throw new Error('fixture');

            await expectAppError(ERROR_CODE.NOT_FOUND, () =>
                customQuestionService.reorder({ ids: [third.id, second.id, crypto.randomUUID()] }),
            );

            const rows = await customQuestionService.list();
            expect(rows.map((q) => q.id)).toEqual([first.id, second.id, third.id]);
        });
    });

    test('intake enforces required answers', async () => {
        await customQuestionService.create({
            key: 'blood_thinners',
            label: 'On blood thinners?',
            kind: 'boolean',
            required: true,
            sortOrder: 0,
        });

        await expectAppError(ERROR_CODE.CUSTOM_QUESTION_REQUIRED, () =>
            customQuestionService.validateIntake({}),
        );
    });

    test('checks the answer against the question kind', async () => {
        await customQuestionService.create({
            key: 'visits_per_year',
            label: 'Visits per year',
            kind: 'number',
            required: false,
            sortOrder: 0,
        });

        expect(await customQuestionService.validateIntake({ visits_per_year: '3' })).toEqual({
            visits_per_year: 3,
        });
        await expectAppError(ERROR_CODE.VALIDATION, () =>
            customQuestionService.validateIntake({ visits_per_year: 'often' }),
        );
    });

    test('a date answer is a real calendar day, stored as it came in', async () => {
        await customQuestionService.create({
            key: 'last_xray',
            label: 'Last x-ray',
            kind: 'date',
            required: false,
            sortOrder: 0,
        });

        expect(await customQuestionService.validateIntake({ last_xray: '2026-02-28' })).toEqual({
            last_xray: '2026-02-28',
        });

        for (const answer of ['2026-02-31', '28-02-2026', '2026-02-28T10:00:00Z']) {
            await expectAppError(ERROR_CODE.VALIDATION, () =>
                customQuestionService.validateIntake({ last_xray: answer }),
            );
        }
    });

    test('a select answer must be one of its options', async () => {
        await customQuestionService.create({
            key: 'referral',
            label: 'How did you hear about us?',
            kind: 'select',
            options: ['friend', 'facebook'],
            required: false,
            sortOrder: 0,
        });

        expect(await customQuestionService.validateIntake({ referral: 'friend' })).toEqual({
            referral: 'friend',
        });
        await expectAppError(ERROR_CODE.VALIDATION, () =>
            customQuestionService.validateIntake({ referral: 'billboard' }),
        );
    });

    test('refuses an answer to a key no question owns', async () => {
        await expectAppError(ERROR_CODE.VALIDATION, () =>
            customQuestionService.validateIntake({ allergies: 'penicillin' }),
        );
        await expectAppError(ERROR_CODE.VALIDATION, () =>
            customQuestionService.validatePatch({}, { allergeis: 'penicillin' }),
        );
    });

    describe('a patch against a questionnaire that has since changed', () => {
        test('does not demand a question that became required', async () => {
            const question = await customQuestionService.create({
                key: 'blood_thinners',
                label: 'On blood thinners?',
                kind: 'boolean',
                required: false,
                sortOrder: 0,
            });
            await customQuestionService.create({
                key: 'allergies',
                label: 'Allergies',
                kind: 'text',
                required: false,
                sortOrder: 1,
            });

            const stored = await customQuestionService.validateIntake({ allergies: 'none' });
            await customQuestionService.update({ id: question.id, required: true });

            expect(await customQuestionService.validatePatch(stored, { allergies: 'penicillin' })).toEqual({
                allergies: 'penicillin',
            });
        });

        test('keeps a select answer whose option was removed', async () => {
            const question = await customQuestionService.create({
                key: 'referral',
                label: 'How did you hear about us?',
                kind: 'select',
                options: ['friend', 'facebook'],
                required: false,
                sortOrder: 0,
            });
            await customQuestionService.create({
                key: 'allergies',
                label: 'Allergies',
                kind: 'text',
                required: false,
                sortOrder: 1,
            });

            const stored = await customQuestionService.validateIntake({ referral: 'facebook' });
            await customQuestionService.update({ id: question.id, options: ['friend'] });

            expect(await customQuestionService.validatePatch(stored, { allergies: 'none' })).toEqual({
                referral: 'facebook',
                allergies: 'none',
            });
            await expectAppError(ERROR_CODE.VALIDATION, () =>
                customQuestionService.validatePatch(stored, { referral: 'facebook' }),
            );
        });

        test('keeps the answer to a deactivated question, and still lets it be edited', async () => {
            const question = await customQuestionService.create({
                key: 'referral',
                label: 'How did you hear about us?',
                kind: 'select',
                options: ['friend', 'facebook'],
                required: true,
                sortOrder: 0,
            });
            await customQuestionService.create({
                key: 'allergies',
                label: 'Allergies',
                kind: 'text',
                required: false,
                sortOrder: 1,
            });

            const stored = await customQuestionService.validateIntake({ referral: 'friend' });
            await customQuestionService.update({ id: question.id, active: false });

            expect(await customQuestionService.validatePatch(stored, { allergies: 'none' })).toEqual({
                referral: 'friend',
                allergies: 'none',
            });
            expect(await customQuestionService.validatePatch(stored, { referral: '' })).toEqual({});
        });
    });

    test('reports what a record is missing against the questionnaire today', async () => {
        const referral = await customQuestionService.create({
            key: 'referral',
            label: 'How did you hear about us?',
            kind: 'select',
            options: ['friend', 'facebook'],
            required: false,
            sortOrder: 0,
        });
        const retired = await customQuestionService.create({
            key: 'fax',
            label: 'Fax number',
            kind: 'text',
            required: false,
            sortOrder: 1,
        });

        const stored = await customQuestionService.validateIntake({ referral: 'facebook', fax: '123' });
        expect(await customQuestionService.auditAnswers(stored)).toEqual([]);

        await customQuestionService.update({ id: referral.id, options: ['friend', 'instagram'] });
        await customQuestionService.update({ id: retired.id, active: false });
        await customQuestionService.create({
            key: 'blood_thinners',
            label: 'On blood thinners?',
            kind: 'boolean',
            required: true,
            sortOrder: 2,
        });

        expect(await customQuestionService.auditAnswers(stored)).toEqual([
            {
                key: 'referral',
                label: 'How did you hear about us?',
                labelAr: null,
                required: false,
                reason: 'answer_no_longer_valid',
            },
            {
                key: 'blood_thinners',
                label: 'On blood thinners?',
                labelAr: null,
                required: true,
                reason: 'unanswered',
            },
        ]);
    });

    test('a blank answer clears the key, unless the question is required', async () => {
        await customQuestionService.create({
            key: 'allergies',
            label: 'Allergies',
            kind: 'text',
            required: false,
            sortOrder: 0,
        });
        await customQuestionService.create({
            key: 'blood_thinners',
            label: 'On blood thinners?',
            kind: 'boolean',
            required: true,
            sortOrder: 1,
        });

        const stored = await customQuestionService.validateIntake({
            allergies: 'penicillin',
            blood_thinners: true,
        });

        expect(await customQuestionService.validatePatch(stored, { allergies: '' })).toEqual({
            blood_thinners: true,
        });
        await expectAppError(ERROR_CODE.CUSTOM_QUESTION_REQUIRED, () =>
            customQuestionService.validatePatch(stored, { blood_thinners: null }),
        );
    });
});

describe('patient', () => {
    /**
     * Every patient carries this clinic's own number, generated once. It is what
     * goes at the top of their page in the paper book (one page per patient), so
     * a record without one cannot be filed — which is why the column is NOT NULL
     * rather than something a screen fills in later.
     */
    test('gives every registration a ref, whichever path made it', async () => {
        const registered = await patientService.create({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });
        // What booking uses when the patient is not on file yet.
        const booked = await patientService.createMinimal({
            name: 'Walk In',
            phone: '01098765432',
            birthDate: '1990-01-01',
        });

        expect(registered.ref).toMatch(PATIENT_REF_PATTERN);
        expect(booked.ref).toMatch(PATIENT_REF_PATTERN);
        expect(registered.ref).not.toBe(booked.ref);
    });

    // A duplicate or a test entry, and everything hanging off it. The visit
    // going too is what makes this different from cancelling their bookings.
    test('deletes a patient with their bookings and visits', async () => {
        const { branch, patient } = await fixtures();
        const booked = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(),
            offsetMinutes: 0,
        });
        const { visitId } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            offsetMinutes: 0,
        });

        await patientService.delete(patient.id);

        await expectAppError(ERROR_CODE.NOT_FOUND, () => patientService.byId(patient.id));
        await expectAppError(ERROR_CODE.NOT_FOUND, () => appointmentService.byId(booked.id));
        await expectAppError(ERROR_CODE.NOT_FOUND, () => visitService.byId(visitId));
        expect(await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 })).toEqual([]);
    });

    test('refuses to delete a patient who has a payment on file', async () => {
        const { branch, patient, extraction } = await fixtures();
        const { visitId } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            offsetMinutes: 0,
        });
        await visitService.setProcedures({
            visitId,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });
        await visitService.recordPayment({ visitId, amount: 10_000, method: 'cash' });

        await expectAppError(ERROR_CODE.HAS_PAYMENTS, () => patientService.delete(patient.id));
        expect((await patientService.byId(patient.id)).history).toHaveLength(1);
    });

    test('keeps the old system’s number beside its own, and they are different facts', async () => {
        const migrated = await patientService.create({
            name: 'Carried Over',
            phone: '01011112222',
            birthDate: '1990-01-01',
            legacyRef: '4417',
            custom: {},
        });
        const fresh = await patientService.create({
            name: 'Registered Here',
            phone: '01033334444',
            birthDate: '1990-01-01',
            custom: {},
        });

        expect(migrated.legacyRef).toBe('4417');
        expect(migrated.ref).not.toBe('4417');
        // A patient registered since the cutoff never had an old number, and a
        // blank says that rather than inventing one.
        expect(fresh.legacyRef).toBeNull();
        expect(fresh.ref).toMatch(PATIENT_REF_PATTERN);
    });

    // The constraint is what makes the generator's retry meaningful, so it is
    // worth asserting rather than assumed. Awaited inside a try rather than
    // through `.rejects`: a postgres.js query is lazy and only runs when it is
    // actually awaited, so `expect(query).rejects` hangs instead of failing.
    test('refuses two patients with the same ref', async () => {
        const first = await patientService.create({
            name: 'First',
            phone: '01011110000',
            birthDate: '1990-01-01',
            custom: {},
        });

        let refused = false;
        try {
            await sql`INSERT INTO patients (id, ref, name, phone, birth_date, custom)
                      VALUES (${uuid()}, ${first.ref}, 'Second', '+201022220000', '1990-01-01', '{}'::jsonb)`;
        } catch {
            refused = true;
        }

        expect(refused).toBe(true);
    });

    test('numbers patients 1, 2, 3 on a clinic that has none', async () => {
        const refs: string[] = [];
        for (const phone of ['01011110001', '01011110002']) {
            refs.push(
                (
                    await patientService.create({
                        name: 'Numbered',
                        phone,
                        birthDate: '1990-01-01',
                        custom: {},
                    })
                ).ref,
            );
        }
        refs.push(
            (
                await patientService.createMinimal({
                    name: 'Booked In',
                    phone: '01011110003',
                    birthDate: '1990-01-01',
                })
            ).ref,
        );

        expect(refs).toEqual(['1', '2', '3']);
        expect((await settingsService.get()).patientRefNext).toBe(4);
    });

    // The reported figure, the other way round from the bug: a clinic that sets
    // the next patient number to 910 gets 910, and the one after it gets 911.
    // `patient_ref_last` gave them 911 and 912, because the field said "last"
    // and everybody read it as "next".
    test('hands out the number the clinic sets, then the one after it', async () => {
        await settingsService.update({ patientRefNext: 910 });

        const first = await patientService.create({
            name: 'Carried On',
            phone: '01011112222',
            birthDate: '1990-01-01',
            custom: {},
        });
        const second = await patientService.create({
            name: 'And Then',
            phone: '01011112223',
            birthDate: '1990-01-01',
            custom: {},
        });

        expect([first.ref, second.ref]).toEqual(['910', '911']);
        expect((await settingsService.get()).patientRefNext).toBe(912);
    });

    test('two registrations at once get two numbers', async () => {
        const created = await Promise.all(
            ['01020000001', '01020000002', '01020000003', '01020000004', '01020000005'].map((phone) =>
                patientService.create({ name: 'Concurrent', phone, birthDate: '1990-01-01', custom: {} }),
            ),
        );

        expect(created.map((row) => row.ref).sort()).toEqual(['1', '2', '3', '4', '5']);
    });

    test('a refused registration does not use a number up', async () => {
        await expectAppError(ERROR_CODE.INVALID_PHONE, () =>
            patientService.create({
                name: 'Bad Phone',
                phone: 'not a phone',
                birthDate: '1990-01-01',
                custom: {},
            }),
        );
        await sql`INSERT INTO custom_questions (id, key, label, kind, required)
                  VALUES (${uuid()}, 'allergies', 'Allergies', 'text', true)`;
        await expectAppError(ERROR_CODE.CUSTOM_QUESTION_REQUIRED, () =>
            patientService.create({
                name: 'No Answers',
                phone: '01011113333',
                birthDate: '1990-01-01',
                custom: {},
            }),
        );

        const next = await patientService.createMinimal({
            name: 'Next',
            phone: '01011114444',
            birthDate: '1990-01-01',
        });
        expect(next.ref).toBe('1');
    });

    test('two simultaneous registrations still get consecutive numbers', async () => {
        await settingsService.update({ patientRefNext: 910 });

        const together = await Promise.all(
            ['01030000001', '01030000002'].map((phone) =>
                patientService.create({ name: 'At Once', phone, birthDate: '1990-01-01', custom: {} }),
            ),
        );

        expect(together.map((row) => row.ref).sort()).toEqual(['910', '911']);
        expect((await settingsService.get()).patientRefNext).toBe(912);
    });

    // At, not below: the value is handed out as it stands, so a next number
    // equal to a ref on file would hand that number out twice.
    test('refuses a next number a patient already has, and leaves the counter alone', async () => {
        await patientService.create({
            name: 'One',
            phone: '01011110001',
            birthDate: '1990-01-01',
            custom: {},
        });
        await patientService.create({
            name: 'Two',
            phone: '01011110002',
            birthDate: '1990-01-01',
            custom: {},
        });

        await expectAppError(ERROR_CODE.PATIENT_REF_BELOW_EXISTING, () =>
            settingsService.update({ patientRefNext: 2 }),
        );
        expect((await settingsService.get()).patientRefNext).toBe(3);

        const kept = await settingsService.update({ patientRefNext: 3 });
        expect(kept.patientRefNext).toBe(3);
    });

    // Patients from before numbering keep their codes. One that happens to be
    // all digits is a number the counter could reach, so it is the floor too.
    test('leaves existing codes alone, and counts an all-digit one as taken', async () => {
        const oldCode = uuid();
        const oldNumber = uuid();
        await sql`INSERT INTO patients (id, ref, name, phone, birth_date)
                  VALUES (${oldCode}, 'W5F5', 'Old Code', '+201000000001', '1990-01-01'),
                         (${oldNumber}, '2345', 'Old Digits', '+201000000002', '1990-01-01')`;

        await expectAppError(ERROR_CODE.PATIENT_REF_BELOW_EXISTING, () =>
            settingsService.update({ patientRefNext: 2345 }),
        );
        await settingsService.update({ patientRefNext: 2346 });

        const next = await patientService.createMinimal({
            name: 'New',
            phone: '01011115555',
            birthDate: '1990-01-01',
        });
        expect(next.ref).toBe('2346');
        expect((await patientService.byId(oldCode)).patient.ref).toBe('W5F5');
    });

    test('refuses a next number the column cannot hold, and one below the first', () => {
        expect(updateSettingsInput.safeParse({ patientRefNext: MAX_PATIENT_REF + 1 }).success).toBe(false);
        expect(updateSettingsInput.safeParse({ patientRefNext: MAX_PATIENT_REF }).success).toBe(true);
        expect(updateSettingsInput.safeParse({ patientRefNext: 0 }).success).toBe(false);
        expect(updateSettingsInput.safeParse({ patientRefNext: 1 }).success).toBe(true);
    });

    test('a ref survives an update that touches everything else', async () => {
        const created = await patientService.create({
            name: 'Before',
            phone: '01055556666',
            birthDate: '1990-01-01',
            custom: {},
        });

        const updated = await patientService.update({
            id: created.id,
            name: 'After',
            phone: '01077778888',
            gender: 'female',
        });

        expect(updated.ref).toBe(created.ref);
    });

    test('notes are written on their own and survive an update that does not name them', async () => {
        const created = await patientService.create({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });
        expect(created.notes).toBeNull();

        await patientService.update({ id: created.id, notes: 'Prefers mornings' });
        await patientService.update({ id: created.id, phone: '01098765432' });
        expect((await patientService.byId(created.id)).patient.notes).toBe('Prefers mornings');

        const cleared = await patientService.update({ id: created.id, notes: null });
        expect(cleared.notes).toBeNull();
    });

    test('normalizes the phone on write and derives age on read', async () => {
        const created = await patientService.create({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });

        expect(created.phone).toBe('+201012345678');
        expect(created.age).toBeGreaterThan(30);
    });

    test('finds a patient by name fragment or by local phone', async () => {
        await patientService.create({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });

        expect((await patientService.search({ q: 'adia', limit: 25 })).length).toBe(1);
        expect((await patientService.search({ q: '01012345678', limit: 25 })).length).toBe(1);
        expect((await patientService.search({ q: 'nobody', limit: 25 })).length).toBe(0);
    });

    // What the Patients tab opens on. `search('')` answers nothing by design, so
    // browsing is its own procedure — and its `total` is the register rather than
    // the page, which is the number the list draws beside its heading.
    test('browses the newest registrations, and counts the whole register', async () => {
        const first = await patientService.create({
            name: 'Registered First',
            phone: '01011111111',
            birthDate: '1990-01-01',
            custom: {},
        });
        const second = await patientService.create({
            name: 'Registered Second',
            phone: '01022222222',
            birthDate: '1990-01-01',
            custom: {},
        });

        const page = await patientService.recent({ limit: 1 });

        expect(page.patients.map((row) => row.id)).toEqual([second.id]);
        expect(page.total).toBe(2);
        expect(first.id).not.toBe(second.id);
    });

    test('merges a partial custom patch instead of replacing it', async () => {
        await customQuestionService.create({
            key: 'allergies',
            label: 'Allergies',
            kind: 'text',
            required: false,
            sortOrder: 0,
        });
        await customQuestionService.create({
            key: 'notes_for_doctor',
            label: 'Notes',
            kind: 'text',
            required: false,
            sortOrder: 1,
        });

        const created = await patientService.create({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: { allergies: 'penicillin', notes_for_doctor: 'anxious' },
        });

        const updated = await patientService.update({ id: created.id, custom: { allergies: 'none' } });

        expect(updated.custom).toEqual({ allergies: 'none', notes_for_doctor: 'anxious' });
    });

    test('editing an old patient survives the questionnaire changing under them', async () => {
        const referral = await customQuestionService.create({
            key: 'referral',
            label: 'How did you hear about us?',
            kind: 'select',
            options: ['friend', 'facebook'],
            required: false,
            sortOrder: 0,
        });
        const bloodThinners = await customQuestionService.create({
            key: 'blood_thinners',
            label: 'On blood thinners?',
            kind: 'boolean',
            required: false,
            sortOrder: 1,
        });

        const created = await patientService.create({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: { referral: 'facebook' },
        });

        await customQuestionService.update({ id: referral.id, options: ['friend', 'instagram'] });
        await customQuestionService.update({ id: bloodThinners.id, required: true });

        const updated = await patientService.update({ id: created.id, phone: '01098765432' });

        expect(updated.phone).toBe('+201098765432');
        expect(updated.custom).toEqual({ referral: 'facebook' });
    });

    test('answers a question added long after the patient was registered', async () => {
        const created = await patientService.create({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });

        await customQuestionService.create({
            key: 'blood_thinners',
            label: 'On blood thinners?',
            kind: 'boolean',
            required: true,
            sortOrder: 0,
        });

        const before = await patientService.byId(created.id);
        expect(before.questionnaireGaps).toEqual([
            {
                key: 'blood_thinners',
                label: 'On blood thinners?',
                labelAr: null,
                required: true,
                reason: 'unanswered',
            },
        ]);

        const updated = await patientService.update({
            id: created.id,
            custom: { blood_thinners: false },
        });

        expect(updated.custom).toEqual({ blood_thinners: false });
        expect((await patientService.byId(created.id)).questionnaireGaps).toEqual([]);
    });

    test('rejects a phone that cannot be normalized', async () => {
        await expectAppError(ERROR_CODE.INVALID_PHONE, () =>
            patientService.create({
                name: 'Nobody',
                phone: 'not a phone',
                birthDate: '1990-01-01',
                custom: {},
            }),
        );
    });

    // The record is read to answer "has this patient turned up before, and what
    // did we do", so the history is over appointments: a no-show has no visit
    // and no money, and still belongs on it, carrying what was going to be done.
    test('history carries what was done, and keeps the appointments that never became visits', async () => {
        const { patient, extraction, appointment, visit } = await checkedInVisit();

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UR6' }],
        });

        const missed = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: (await branchService.list({ includeInactive: false }))[0]?.id ?? '',
            startsAt: slot(120),
            offsetMinutes: 0,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL4' }],
        });
        await appointmentService.update({ id: missed.id, status: 'no_show' });

        const { history } = await patientService.byId(patient.id);
        const performed = history.find((row) => row.appointmentId === appointment.id);
        const planned = history.find((row) => row.appointmentId === missed.id);

        expect(performed?.visitId).toBe(visit.id);
        expect(performed?.procedures).toEqual([{ name: 'Extraction', quantity: 1, tooth: 'UR6' }]);
        expect(performed?.chargedTotal).toBe(EXTRACTION_PRICE);

        // No visit, so no money — and the booking is the only record of the plan.
        expect(planned?.visitId).toBeNull();
        expect(planned?.status).toBe('no_show');
        expect(planned?.chargedTotal).toBe(0);
        expect(planned?.balance).toBe(0);
        expect(planned?.procedures).toEqual([{ name: 'Extraction', quantity: 1, tooth: 'UL4' }]);
    });
});

describe('appointment', () => {
    test('books, generates a ref, and creates the reminder', async () => {
        const { branch, patient } = await fixtures();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });

        expect(appointment.ref).toMatch(/^\d{6}-[A-Z2-9]{4}$/);
        expect(appointment.status).toBe('booked');

        const pending = await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });
        expect(pending.map((r) => r.appointmentId)).toContain(appointment.id);
    });

    test('creates the patient in the same call when they are new', async () => {
        const { branch } = await fixtures();

        const appointment = await appointmentService.create({
            patient: { kind: 'new', name: 'Walk-up Wael', phone: '01099999999', birthDate: '1990-01-01' },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });

        const found = await patientService.search({ q: 'Wael', limit: 25 });
        expect(found[0]?.id).toBe(appointment.patientId);
        expect(found[0]?.phone).toBe('+201099999999');
        expect(found[0]?.email).toBeNull();
        expect(found[0]?.birthDate).toBe('1990-01-01');
    });

    // The desk is not always on the phone — when the card is in her hand, the
    // details go on the record with the booking rather than in a second visit
    // to it. The questionnaire is still not asked here (§7.8).
    test('keeps the details the booking collected about a new patient', async () => {
        const { branch } = await fixtures();

        const appointment = await appointmentService.create({
            patient: {
                kind: 'new',
                name: 'Detailed Dalia',
                phone: '01098765432',
                email: 'dalia@example.com',
                birthDate: '1990-11-05',
                gender: 'female',
                notes: 'Anxious about the drill.',
            },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });

        const found = await patientService.search({ q: 'Dalia', limit: 25 });
        expect(found[0]?.id).toBe(appointment.patientId);
        expect(found[0]?.email).toBe('dalia@example.com');
        expect(found[0]?.birthDate).toBe('1990-11-05');
        expect(found[0]?.gender).toBe('female');
        expect(found[0]?.notes).toBe('Anxious about the drill.');
        expect(found[0]?.age).not.toBeNull();
        expect(found[0]?.custom).toEqual({});
    });

    test('reports an overlap as SLOT_OVERLAP rather than a database error', async () => {
        const { branch, patient } = await fixtures();
        const startsAt = todaySlot();

        await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt,
            offsetMinutes: 0,
        });

        await expectAppError(ERROR_CODE.SLOT_OVERLAP, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt,
                offsetMinutes: 0,
            }),
        );
    });

    test('refuses a duration the clinic has not configured', async () => {
        const { branch, patient } = await fixtures();

        await expectAppError(ERROR_CODE.INVALID_DURATION, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt: todaySlot(),
                durationMinutes: 37,
                offsetMinutes: 0,
            }),
        );
    });

    test('the day view embeds the patient', async () => {
        const { branch, patient } = await fixtures();
        const startsAt = todaySlot();

        await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt,
            offsetMinutes: 0,
        });

        const day = await appointmentService.byDate({
            date: startsAt.slice(0, 10),
            branchId: branch.id,
            offsetMinutes: 0,
        });

        expect(day.length).toBe(1);
        expect(day[0]?.patient.name).toBe('Nadia Hassan');
    });

    test('cancelling frees the slot and skips the reminder', async () => {
        const { branch, patient } = await fixtures();
        const startsAt = todaySlot();

        const first = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt,
            offsetMinutes: 0,
        });

        await appointmentService.cancel(first.id);

        const rebooked = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt,
            offsetMinutes: 0,
        });

        expect(rebooked.id).not.toBe(first.id);

        const pending = await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });
        expect(pending.map((r) => r.appointmentId)).not.toContain(first.id);
    });

    test('refuses to cancel twice', async () => {
        const { branch, patient } = await fixtures();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });

        await appointmentService.cancel(appointment.id);
        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            appointmentService.cancel(appointment.id),
        );
    });

    test('a walk-in books and checks in at once', async () => {
        const { branch, patient } = await fixtures();

        const { appointment, visitId } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            offsetMinutes: 0,
        });

        expect(appointment.channel).toBe('walk_in');
        expect(appointment.status).toBe('checked_in');

        // Nothing was asked for, and check-in adds no checkup of its own.
        const visit = await visitService.byId(visitId);
        expect(visit.procedures).toEqual([]);
        expect(visit.chargedTotal).toBe(0);
    });

    test('lists an appointment that has already ended as missed', async () => {
        const { branch, patient } = await fixtures();
        const past = new Date(Date.now() - 3 * 3_600_000).toISOString();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: past,
            offsetMinutes: 0,
        });

        const missed = await appointmentService.missed({ limit: 100 });
        expect(missed.map((a) => a.id)).toContain(appointment.id);

        expect(missed.find((a) => a.id === appointment.id)?.status).toBe('booked');
    });

    test('never lists an appointment awaiting payment as missed', async () => {
        const { branch, patient } = await fixtures();
        // Ended already, but still on today's clinic day (offset 0 → UTC), or
        // the check-in below refuses it. Within three hours of UTC midnight
        // "three hours ago" is yesterday, which is when CI happens to run.
        const now = Date.now();
        const sinceMidnight = now % 86_400_000;
        const past = new Date(now - Math.min(3 * 3_600_000, Math.floor(sinceMidnight / 2))).toISOString();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: past,
            offsetMinutes: 0,
        });
        await visitService.checkIn({ appointmentId: appointment.id });
        await appointmentService.awaitPayment(appointment.id);

        const missed = await appointmentService.missed({ limit: 100 });
        expect(missed.map((a) => a.id)).not.toContain(appointment.id);
    });

    test('the doctor sends a checked-in patient to the desk to pay', async () => {
        const { branch, patient } = await fixtures();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        await visitService.checkIn({ appointmentId: appointment.id });

        const awaiting = await appointmentService.awaitPayment(appointment.id);
        expect(awaiting.status).toBe('awaiting_payment');
    });

    test('refuses to await payment on an appointment that is only booked', async () => {
        const { branch, patient } = await fixtures();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            appointmentService.awaitPayment(appointment.id),
        );
    });

    test('refuses to await payment twice', async () => {
        const { branch, patient } = await fixtures();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        await visitService.checkIn({ appointmentId: appointment.id });
        await appointmentService.awaitPayment(appointment.id);

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            appointmentService.awaitPayment(appointment.id),
        );
    });

    test('refuses to await payment on a cancelled appointment', async () => {
        const { branch, patient } = await fixtures();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        await appointmentService.cancel(appointment.id);

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            appointmentService.awaitPayment(appointment.id),
        );
    });

    test('two concurrent calls cannot both move the same appointment', async () => {
        const { branch, patient } = await fixtures();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        await visitService.checkIn({ appointmentId: appointment.id });

        const results = await Promise.allSettled([
            appointmentService.awaitPayment(appointment.id),
            appointmentService.awaitPayment(appointment.id),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
        const rejected = results.find((r) => r.status === 'rejected');
        expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
        expect(((rejected as PromiseRejectedResult).reason as AppError).code).toBe(
            ERROR_CODE.INVALID_STATUS_TRANSITION,
        );
    });

    test('an appointment awaiting payment frees its slot for a new booking', async () => {
        const { branch, patient } = await fixtures();
        const startsAt = todaySlot();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt,
            offsetMinutes: 0,
        });
        await visitService.checkIn({ appointmentId: appointment.id });

        await expectAppError(ERROR_CODE.SLOT_OVERLAP, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt,
                offsetMinutes: 0,
            }),
        );

        await appointmentService.awaitPayment(appointment.id);

        const next = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt,
            offsetMinutes: 0,
        });
        expect(next.id).toBeTruthy();
    });
});

/**
 * §7 — a booking carries the list of procedures the secretary expects, not a
 * single type. The §5 rules are the same ones a visit line obeys, so a list
 * that can be booked is a list that can be recorded.
 */
describe('appointment procedures', () => {
    test('books several procedures and reads them back with their names', async () => {
        const { branch, patient, rootCanal, extraction } = await fixtures();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [
                { procedureId: rootCanal.id, quantity: 1 },
                { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
            ],
        });

        const read = await appointmentService.byId(appointment.id);
        expect(read.procedures.map((p) => [p.name, p.tooth])).toEqual([
            ['Root canal', null],
            ['Extraction', 'UL6'],
        ]);
    });

    test('the day view carries each booking its own procedures', async () => {
        const { branch, patient, rootCanal } = await fixtures();
        const startsAt = todaySlot();

        await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt,
            offsetMinutes: 0,
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
        });
        await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(60),
            offsetMinutes: 0,
        });

        const day = await appointmentService.byDate({
            date: startsAt.slice(0, 10),
            offsetMinutes: 0,
        });

        expect(day.map((a) => a.procedures.map((p) => p.name))).toEqual([['Root canal'], []]);
    });

    test('a tooth-specific procedure booked without a tooth is refused', async () => {
        const { branch, patient, extraction } = await fixtures();

        await expectAppError(ERROR_CODE.TOOTH_REQUIRED, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt: todaySlot(),
                offsetMinutes: 0,
                procedures: [{ procedureId: extraction.id, quantity: 1 }],
            }),
        );
    });

    test('a tooth on a procedure that is not tooth-specific is refused', async () => {
        const { branch, patient, rootCanal } = await fixtures();

        await expectAppError(ERROR_CODE.TOOTH_NOT_APPLICABLE, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt: todaySlot(),
                offsetMinutes: 0,
                procedures: [{ procedureId: rootCanal.id, quantity: 1, tooth: 'UL6' }],
            }),
        );
    });

    test('the same procedure twice on one tooth is refused, but once per tooth is fine', async () => {
        const { branch, patient, extraction } = await fixtures();

        await expectAppError(ERROR_CODE.PROCEDURE_DUPLICATE, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt: todaySlot(),
                offsetMinutes: 0,
                procedures: [
                    { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
                    { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
                ],
            }),
        );

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [
                { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
                { procedureId: extraction.id, quantity: 1, tooth: 'UR3' },
            ],
        });

        expect((await appointmentService.byId(appointment.id)).procedures).toHaveLength(2);
    });

    test('a booking may not plan a category row', async () => {
        const { branch, patient, rootCanal } = await fixtures();
        const category = await procedureService.create({
            name: 'Restorative',
            defaultPrice: 0,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            sortOrder: 9,
        });
        await procedureService.update({ id: rootCanal.id, parentId: category.id });

        await expectAppError(ERROR_CODE.PROCEDURE_NOT_SELECTABLE, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt: todaySlot(),
                offsetMinutes: 0,
                procedures: [{ procedureId: category.id, quantity: 1 }],
            }),
        );
    });

    test('update replaces the whole list, and omitting it leaves the list alone', async () => {
        const { branch, patient, rootCanal, xray } = await fixtures();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
        });

        await appointmentService.update({ id: appointment.id, note: 'moved rooms' });
        expect((await appointmentService.byId(appointment.id)).procedures.map((p) => p.name)).toEqual([
            'Root canal',
        ]);

        await appointmentService.update({
            id: appointment.id,
            procedures: [{ procedureId: xray.id, quantity: 3 }],
        });
        const replaced = await appointmentService.byId(appointment.id);
        expect(replaced.procedures.map((p) => [p.name, p.quantity])).toEqual([['X-ray', 3]]);

        await appointmentService.update({ id: appointment.id, procedures: [] });
        expect((await appointmentService.byId(appointment.id)).procedures).toEqual([]);
    });

    test('check-in seeds the visit from the plan, priced as of today', async () => {
        const { branch, patient, rootCanal, extraction } = await fixtures();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [
                { procedureId: rootCanal.id, quantity: 1 },
                { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
            ],
        });

        // The catalogue moves between booking and arrival; the visit bills the
        // price on the day, not the one that applied when the slot was taken.
        await procedureService.update({ id: rootCanal.id, defaultPrice: ROOT_CANAL_PRICE + 10_000 });

        const created = await visitService.checkIn({ appointmentId: appointment.id });
        const visit = await visitService.byId(created.id);

        // Exactly the plan: check-in adds no checkup line on top of it.
        expect(visit.procedures.map((l) => [l.name, l.unitPrice]).sort()).toEqual(
            [
                ['Extraction', EXTRACTION_PRICE],
                ['Root canal', ROOT_CANAL_PRICE + 10_000],
            ].sort(),
        );
        expect(visit.procedures.filter((l) => l.isCheckup)).toHaveLength(0);
        expect(visit.computedTotal).toBe(ROOT_CANAL_PRICE + 10_000 + EXTRACTION_PRICE);
    });

    test('a planned checkup is not seeded twice', async () => {
        const { branch, patient, checkup } = await fixtures();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: checkup.id, quantity: 1 }],
        });

        const created = await visitService.checkIn({ appointmentId: appointment.id });
        const visit = await visitService.byId(created.id);

        expect(visit.procedures).toHaveLength(1);
        expect(visit.computedTotal).toBe(CHECKUP_PRICE);
    });

    test('a walk-in books its procedures and seeds them in the same transaction', async () => {
        const { branch, patient, extraction } = await fixtures();

        const { appointment, visitId } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            offsetMinutes: 0,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'LR8' }],
        });

        expect((await appointmentService.byId(appointment.id)).procedures.map((p) => p.tooth)).toEqual([
            'LR8',
        ]);

        const visit = await visitService.byId(visitId);
        expect(visit.procedures.map((l) => l.name)).toEqual(['Extraction']);
    });

    // The chair is occupied at the moment the patient arrives, which is what a
    // running-late day looks like from the desk. The slot in progress is not
    // interrupted, and the walk-in is not refused for it: it starts at the end
    // of the one already in the chair. Before, the row was never considered and
    // the insert died on `appointments_no_overlap` as SLOT_OVERLAP.
    test('a walk-in arriving mid-procedure is seated after it, not turned away', async () => {
        const { branch, patient } = await fixtures();

        const running = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            offsetMinutes: 0,
            durationMinutes: 30,
        });

        const { appointment } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            offsetMinutes: 0,
        });

        expect(appointment.status).toBe('checked_in');
        expect(appointment.startsAt.getTime()).toBe(running.startsAt.getTime() + 30 * 60_000);

        // And the one in the chair stayed exactly where it was.
        expect((await appointmentService.byId(running.id)).startsAt.getTime()).toBe(
            running.startsAt.getTime(),
        );
    });

    test('a refused walk-in leaves neither the booking nor its procedures behind', async () => {
        const { branch, patient, extraction } = await fixtures();

        await expectAppError(ERROR_CODE.TOOTH_REQUIRED, () =>
            appointmentService.walkIn({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                offsetMinutes: 0,
                procedures: [{ procedureId: extraction.id, quantity: 1 }],
            }),
        );

        const rows = await sql<{ count: string }[]>`SELECT count(*) FROM appointment_procedures`;
        expect(Number(rows[0]?.count)).toBe(0);
    });
});

describe('visit', () => {
    /**
     * A visit checked in today. `withWork` books a root canal first, so the
     * visit opens with a line and checkout will take it; a test about an empty
     * visit, or one that sets its own lines, leaves it off.
     */
    async function checkedIn({ withWork = false }: { withWork?: boolean } = {}) {
        const f = await fixtures();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: f.patient.id },
            branchId: f.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            ...(withWork ? { procedures: [{ procedureId: f.rootCanal.id, quantity: 1 }] } : {}),
        });
        const visit = await visitService.checkIn({ appointmentId: appointment.id });
        return { ...f, appointment, visit };
    }

    test('check-in adds no checkup line, so a visit with nothing booked opens at zero', async () => {
        const { visit } = await checkedIn();
        const detail = await visitService.byId(visit.id);

        expect(detail.procedures).toEqual([]);
        expect(detail.computedTotal).toBe(0);
        expect(detail.chargedTotal).toBe(0);
    });

    test('refuses a second check-in for the same appointment', async () => {
        const { appointment } = await checkedIn();

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            visitService.checkIn({ appointmentId: appointment.id }),
        );
    });

    test('refuses a check-in for an appointment on another day, and writes nothing', async () => {
        const f = await fixtures();
        const tomorrow = await appointmentService.create({
            patient: { kind: 'existing', patientId: f.patient.id },
            branchId: f.branch.id,
            startsAt: slot(),
            offsetMinutes: 0,
        });

        await expectAppError(ERROR_CODE.CHECK_IN_NOT_TODAY, () =>
            visitService.checkIn({ appointmentId: tomorrow.id, offsetMinutes: 0 }),
        );

        expect((await appointmentService.byId(tomorrow.id)).status).toBe('booked');
        expect(await visitService.byAppointment(tomorrow.id)).toBeNull();
    });

    test("today is the clinic's day, not the server's", async () => {
        const f = await fixtures();
        const offsetMinutes = 180;
        const { from } = clinicDayOf(new Date(), offsetMinutes);

        const book = (at: number) =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: f.patient.id },
                branchId: f.branch.id,
                startsAt: new Date(at).toISOString(),
                offsetMinutes,
            });

        // Half an hour either side of the clinic's midnight.
        const lastNight = await book(from.getTime() - 30 * 60_000);
        const thisMorning = await book(from.getTime() + 30 * 60_000);

        await expectAppError(ERROR_CODE.CHECK_IN_NOT_TODAY, () =>
            visitService.checkIn({ appointmentId: lastNight.id, offsetMinutes }),
        );
        const visit = await visitService.checkIn({ appointmentId: thisMorning.id, offsetMinutes });
        expect(visit.appointmentId).toBe(thisMorning.id);
    });

    test('adding a procedure waives the checkup', async () => {
        const { visit, checkup, rootCanal } = await checkedIn();

        const updated = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [
                { procedureId: checkup.id, quantity: 1 },
                { procedureId: rootCanal.id, quantity: 1 },
            ],
        });

        expect(updated.procedures.length).toBe(2);
        expect(updated.computedTotal).toBe(ROOT_CANAL_PRICE);
    });

    test('multiplies a quantity procedure by its quantity', async () => {
        const { visit, xray } = await checkedIn();

        const updated = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: xray.id, quantity: 3 }],
        });

        expect(updated.computedTotal).toBe(15_000);
    });

    test('refuses a repeat of a procedure that does not take a quantity', async () => {
        const { visit, rootCanal } = await checkedIn();

        await expectAppError(ERROR_CODE.PROCEDURE_DUPLICATE, () =>
            visitService.setProcedures({
                visitId: visit.id,
                procedures: [
                    { procedureId: rootCanal.id, quantity: 1 },
                    { procedureId: rootCanal.id, quantity: 1 },
                ],
            }),
        );
    });

    // Correcting a finished visit: the wrong tooth was charged and the money is
    // already in the drawer. Reopening is the only edge out of `done`, and the
    // payments have to survive it — they were handed over.
    test('reopens a checked-out visit for correction, keeping what was paid', async () => {
        const { visit, appointment, extraction } = await checkedIn();

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });
        const charged = (await visitService.byId(visit.id)).computedTotal ?? 0;

        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: charged,
            paidTotal: charged,
            method: 'cash',
        });

        const reopened = await visitService.reopen({ visitId: visit.id });

        expect(reopened.completedAt).toBeNull();
        // Cleared with it, or `setProcedures` would recompute around a frozen
        // `chargedTotal` and the bill would not follow the lines.
        expect(reopened.pricedAt).toBeNull();
        expect(reopened.paidTotal).toBe(charged);
        // The appointment stays `done`: the patient came and went home, and
        // correcting the paperwork afterwards does not put them back at the
        // desk waiting to pay — which is what the day view would show.
        expect((await appointmentService.byId(appointment.id)).status).toBe('done');

        // The point of reopening: the list is editable again.
        const corrected = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UR3' }],
        });
        expect(corrected.procedures.map((p) => p.tooth)).toEqual(['UR3']);
    });

    // The other end of the same edit: closing it again, on an appointment that
    // never left `done` and so has no transition left to make.
    test('closes a corrected visit again without a status to move', async () => {
        const { visit, appointment, extraction } = await checkedIn();

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });
        const charged = (await visitService.byId(visit.id)).computedTotal ?? 0;

        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: charged,
            paidTotal: charged,
            method: 'cash',
        });
        await visitService.reopen({ visitId: visit.id });

        const reclosed = await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: charged,
            paidTotal: 0,
            method: 'cash',
        });

        expect(reclosed.completedAt).not.toBeNull();
        expect(reclosed.paidTotal).toBe(charged);
        expect((await appointmentService.byId(appointment.id)).status).toBe('done');
    });

    // Undoing a check-in. The visit and its lines go, and the booking is
    // still a booking — the patient was expected, and whether they came is
    // now for the desk to say with cancel or no-show.
    test('deletes a visit and puts the appointment back to booked', async () => {
        const { visit, appointment } = await checkedIn({ withWork: true });
        expect((await visitService.byId(visit.id)).procedures).toHaveLength(1);

        await visitService.delete({ visitId: visit.id });

        await expectAppError(ERROR_CODE.NOT_FOUND, () => visitService.byId(visit.id));
        expect(await visitService.byAppointment(appointment.id)).toBeNull();
        expect((await appointmentService.byId(appointment.id)).status).toBe('booked');
    });

    // A walk-in has no booking to go back to: the appointment was made for the
    // visit, and a `booked` walk-in on the day view would be a patient who is
    // neither expected nor here.
    test('deleting a walk-in visit takes the appointment with it', async () => {
        const { branch, patient } = await fixtures();
        const { appointment, visitId } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            offsetMinutes: 0,
        });

        await visitService.delete({ visitId });

        await expectAppError(ERROR_CODE.NOT_FOUND, () => appointmentService.byId(appointment.id));
        expect((await patientService.byId(patient.id)).history).toEqual([]);
    });

    // Money is the line. A delete that took a payment with it would move a
    // past day's takings without a trace, so the payment has to be removed
    // first, on its own, and only then does the visit go.
    test('refuses to delete a visit with a payment, until the payment is removed', async () => {
        const { visit, extraction } = await checkedIn();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });
        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: EXTRACTION_PRICE,
            paidTotal: EXTRACTION_PRICE,
            method: 'cash',
        });

        await expectAppError(ERROR_CODE.HAS_PAYMENTS, () => visitService.delete({ visitId: visit.id }));

        const [payment] = (await visitService.byId(visit.id)).payments ?? [];
        if (!payment) throw new Error('expected a payment');
        const after = await visitService.deletePayment({ paymentId: payment.id });
        expect(after.payments).toEqual([]);
        expect(after.paidTotal).toBe(0);
        expect(after.balance).toBe(EXTRACTION_PRICE);

        await visitService.delete({ visitId: visit.id });
        await expectAppError(ERROR_CODE.NOT_FOUND, () => visitService.byId(visit.id));
    });

    // Leaving the chair by deletion hands it on the same as leaving it by
    // checkout: the next patient's visit starts when the chair empties.
    test('deleting the visit in the chair seats the next patient', async () => {
        const { visit: first, branch, patient } = await checkedIn();
        expect(first.inChairAt).not.toBeNull();

        const second = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            offsetMinutes: 0,
        });
        expect((await visitService.byId(second.visitId)).inChairAt).toBeNull();

        await visitService.delete({ visitId: first.id });

        expect((await visitService.byId(second.visitId)).inChairAt).not.toBeNull();
    });

    test('refuses to check out a visit with no procedures on it', async () => {
        const { visit, appointment } = await checkedIn();

        await expectAppError(ERROR_CODE.VISIT_HAS_NO_PROCEDURES, () =>
            visitService.checkOut({ visitId: visit.id, chargedTotal: 0, paidTotal: 0, method: 'cash' }),
        );

        // Nothing closed: the visit stays open and the patient stays checked in.
        expect((await visitService.byId(visit.id)).completedAt).toBeNull();
        expect((await appointmentService.byId(appointment.id)).status).toBe('checked_in');
    });

    test('still refuses to check out a visit that is closed', async () => {
        const { visit, extraction } = await checkedIn();

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });

        await visitService.checkOut({ visitId: visit.id, chargedTotal: 1000, paidTotal: 0, method: 'cash' });

        await expectAppError(ERROR_CODE.VISIT_ALREADY_COMPLETED, () =>
            visitService.checkOut({ visitId: visit.id, chargedTotal: 1000, paidTotal: 0, method: 'cash' }),
        );
    });

    // The other half of a correction: the procedures were right and the money
    // was not. 800 was recorded, 500 was handed over.
    test('corrects what was paid down, keeping the original payment on the record', async () => {
        const { visit, extraction } = await checkedIn();

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });
        const charged = (await visitService.byId(visit.id)).computedTotal ?? 0;

        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: charged,
            paidTotal: charged,
            method: 'cash',
        });
        await visitService.reopen({ visitId: visit.id });

        const corrected = await visitService.setPaid({
            visitId: visit.id,
            paidTotal: charged - 20_000,
            method: 'cash',
        });

        expect(corrected.paidTotal).toBe(charged - 20_000);
        expect(corrected.balance).toBe(20_000);
        // Nothing was edited or deleted — the refund is a row of its own, so
        // both what was entered and what put it right are still readable.
        expect((corrected.payments ?? []).map((p) => p.amount).sort((a, b) => b - a)).toEqual([
            charged,
            -20_000,
        ]);
    });

    test('corrects what was paid up by adding the difference', async () => {
        const { visit, extraction } = await checkedIn();

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });
        const charged = (await visitService.byId(visit.id)).computedTotal ?? 0;

        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: charged,
            paidTotal: 10_000,
            method: 'cash',
        });

        const corrected = await visitService.setPaid({
            visitId: visit.id,
            paidTotal: charged,
            method: 'visa',
        });

        expect(corrected.paidTotal).toBe(charged);
        expect(corrected.balance).toBe(0);
        expect(corrected.payments?.length).toBe(2);
    });

    test('writes nothing when the paid total is what is already on the visit', async () => {
        const { visit, extraction } = await checkedIn();

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });
        const charged = (await visitService.byId(visit.id)).computedTotal ?? 0;

        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: charged,
            paidTotal: charged,
            method: 'cash',
        });

        const same = await visitService.setPaid({
            visitId: visit.id,
            paidTotal: charged,
            method: 'cash',
        });

        // A row of zero would be a payment that moved no money.
        expect(same.payments?.length).toBe(1);
        expect(same.paidTotal).toBe(charged);
    });

    test('refuses to reopen a visit that was never checked out', async () => {
        const { visit } = await checkedIn();

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            visitService.reopen({ visitId: visit.id }),
        );
    });

    test('allows a repeat of the same procedure on a different tooth', async () => {
        const { visit, extraction } = await checkedIn();

        const updated = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [
                { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
                { procedureId: extraction.id, quantity: 1, tooth: 'UR3' },
            ],
        });

        expect(updated.procedures.length).toBe(2);
        expect(updated.computedTotal).toBe(EXTRACTION_PRICE * 2);
        expect(updated.procedures.map((p) => p.tooth).sort()).toEqual(['UL6', 'UR3']);
    });

    test('refuses a repeat of the same procedure on the same tooth', async () => {
        const { visit, extraction } = await checkedIn();

        await expectAppError(ERROR_CODE.PROCEDURE_DUPLICATE, () =>
            visitService.setProcedures({
                visitId: visit.id,
                procedures: [
                    { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
                    { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
                ],
            }),
        );
    });

    test('refuses a tooth-specific procedure with no tooth', async () => {
        const { visit, extraction } = await checkedIn();

        await expectAppError(ERROR_CODE.TOOTH_REQUIRED, () =>
            visitService.setProcedures({
                visitId: visit.id,
                procedures: [{ procedureId: extraction.id, quantity: 1 }],
            }),
        );
    });

    test('refuses a tooth on a procedure that is not tooth-specific', async () => {
        const { visit, rootCanal } = await checkedIn();

        await expectAppError(ERROR_CODE.TOOTH_NOT_APPLICABLE, () =>
            visitService.setProcedures({
                visitId: visit.id,
                procedures: [{ procedureId: rootCanal.id, quantity: 1, tooth: 'UL6' }],
            }),
        );
    });

    test('leaves tooth null on a procedure that is not tooth-specific', async () => {
        const { visit, rootCanal } = await checkedIn();

        const updated = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
        });
        expect(updated.procedures[0]?.tooth).toBeNull();
    });

    test('rejects a tooth that is not on the chart', async () => {
        const { visit, extraction } = await checkedIn();

        expect(
            setProceduresInput.safeParse({
                visitId: visit.id,
                procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL9' }],
            }).success,
        ).toBe(false);
    });

    test('snapshots the price, so a later price change does not rewrite history', async () => {
        const { visit, rootCanal } = await checkedIn();

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
        });
        await procedureService.update({ id: rootCanal.id, defaultPrice: 999_999 });

        const detail = await visitService.byId(visit.id);
        expect(detail.procedures[0]?.unitPrice).toBe(ROOT_CANAL_PRICE);
        expect(detail.computedTotal).toBe(ROOT_CANAL_PRICE);
    });

    test('an explicit price survives a later procedure edit', async () => {
        const { visit, rootCanal } = await checkedIn();

        await visitService.setPrice({ visitId: visit.id, chargedTotal: 200_000 });
        const updated = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
        });

        expect(updated.computedTotal).toBe(ROOT_CANAL_PRICE);
        expect(updated.chargedTotal).toBe(200_000);
    });

    test('refuses to re-price a visit that is already checked out', async () => {
        const { visit } = await checkedIn({ withWork: true });
        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 100_000,
            paidTotal: 40_000,
            method: 'cash',
        });

        await expectAppError(ERROR_CODE.VISIT_ALREADY_COMPLETED, () =>
            visitService.setPrice({ visitId: visit.id, chargedTotal: 10_000 }),
        );

        const after = await visitService.byId(visit.id);
        expect(after.chargedTotal).toBe(100_000);
        expect(after.balance).toBe(60_000);
    });

    test('checks out with a partial payment and leaves a balance', async () => {
        const { visit, appointment } = await checkedIn({ withWork: true });

        const done = await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 100_000,
            paidTotal: 40_000,
            method: 'cash',
        });

        expect(done.completedAt).not.toBeNull();
        expect(done.paidTotal).toBe(40_000);
        expect(done.balance).toBe(60_000);

        const after = await appointmentService.byId(appointment.id);
        expect(after.status).toBe('done');
    });

    test('checks out a patient the doctor sent to the desk', async () => {
        const { visit, appointment } = await checkedIn({ withWork: true });
        await appointmentService.awaitPayment(appointment.id);

        const done = await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 100_000,
            paidTotal: 100_000,
            method: 'cash',
        });

        expect(done.completedAt).not.toBeNull();
        expect(done.balance).toBe(0);
        expect((await appointmentService.byId(appointment.id)).status).toBe('done');
    });

    test('refuses to check out against an appointment that is not in progress', async () => {
        const { visit, appointment } = await checkedIn();
        await sql`UPDATE appointments SET status = 'no_show' WHERE id = ${appointment.id}`;

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            visitService.checkOut({
                visitId: visit.id,
                chargedTotal: 100_000,
                paidTotal: 0,
                method: 'cash',
            }),
        );
    });

    test('checks out with nothing paid', async () => {
        const { visit } = await checkedIn({ withWork: true });

        const done = await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 100_000,
            paidTotal: 0,
            method: 'cash',
        });

        expect(done.payments?.length).toBe(0);
        expect(done.balance).toBe(100_000);
    });

    test('refuses to check out twice', async () => {
        const { visit } = await checkedIn({ withWork: true });
        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 1_000,
            paidTotal: 0,
            method: 'cash',
        });

        await expectAppError(ERROR_CODE.VISIT_ALREADY_COMPLETED, () =>
            visitService.checkOut({
                visitId: visit.id,
                chargedTotal: 1_000,
                paidTotal: 0,
                method: 'cash',
            }),
        );
    });

    test('records a later payment against the balance', async () => {
        const { visit } = await checkedIn({ withWork: true });
        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 100_000,
            paidTotal: 40_000,
            method: 'cash',
        });

        const after = await visitService.recordPayment({
            visitId: visit.id,
            amount: 60_000,
            method: 'instapay',
        });

        expect(after.paidTotal).toBe(100_000);
        expect(after.balance).toBe(0);
        expect(after.chargedTotal).toBe(100_000);
    });

    test("requires a note when the method is 'other'", async () => {
        const { visit } = await checkedIn();

        await expectAppError(ERROR_CODE.PAYMENT_NOTE_REQUIRED, () =>
            visitService.recordPayment({
                visitId: visit.id,
                amount: 1_000,
                method: 'other',
                methodNote: null,
            }),
        );
    });
});

describe('balance', () => {
    async function owing(amount: number, paid: number) {
        const f = await fixtures();
        // Booked with a line, because checkout refuses a visit with none.
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: f.patient.id },
            branchId: f.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: f.rootCanal.id, quantity: 1 }],
        });
        const visit = await visitService.checkIn({ appointmentId: appointment.id });
        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: amount,
            paidTotal: paid,
            method: 'cash',
        });
        return { ...f, visit };
    }

    test('aggregates what a patient owes across visits', async () => {
        const { patient } = await owing(100_000, 40_000);

        const report = await balanceService.outstanding();
        expect(report.total).toBe(60_000);
        expect(report.patients[0]?.patientId).toBe(patient.id);
        expect(report.patients[0]?.balance).toBe(60_000);
    });

    test('a fully paid visit does not appear', async () => {
        await owing(100_000, 100_000);

        const report = await balanceService.outstanding();
        expect(report.total).toBe(0);
        expect(report.patients.length).toBe(0);
    });

    test('lists the patient visits that still owe', async () => {
        const { patient, visit } = await owing(100_000, 40_000);

        const rows = await balanceService.byPatient(patient.id);
        expect(rows.length).toBe(1);
        expect(rows[0]?.visitId).toBe(visit.id);
        expect(rows[0]?.balance).toBe(60_000);
    });

    test('reports charged against collected for a period', async () => {
        await owing(100_000, 40_000);
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

        const summary = await balanceService.summary({ from: today, to: tomorrow, offsetMinutes: 0 });

        expect(summary.charged).toBe(100_000);
        expect(summary.collected).toBe(40_000);
        expect(summary.difference).toBe(60_000);
    });
});

describe('reminder', () => {
    test('renders a template and builds the WhatsApp link', async () => {
        const { branch, patient } = await fixtures();
        await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(),
            offsetMinutes: 0,
        });

        const [reminder] = await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });

        expect(reminder?.message).toContain('Nadia Hassan');
        expect(reminder?.whatsAppUrl.startsWith('https://wa.me/201012345678?text=')).toBe(true);
    });

    test('marking sent takes it off the pending list', async () => {
        const { branch, patient } = await fixtures();
        await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(),
            offsetMinutes: 0,
        });

        const [reminder] = await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });
        if (!reminder) throw new Error('expected a pending reminder');

        await reminderService.markSent(reminder.id);

        expect((await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 })).length).toBe(
            0,
        );
    });

    test('dismissing for today records the date on settings', async () => {
        await reminderService.dismissToday({ date: '2026-08-03' });
        expect((await settingsService.get()).reminderDismissedOn).toBe('2026-08-03');
    });

    test('resuming today clears only that date', async () => {
        await reminderService.dismissToday({ date: '2026-08-03' });
        await reminderService.resumeToday({ date: '2026-08-02' });
        expect((await settingsService.get()).reminderDismissedOn).toBe('2026-08-03');

        await reminderService.resumeToday({ date: '2026-08-03' });
        expect((await settingsService.get()).reminderDismissedOn).toBeNull();
    });

    test('leaves an unknown placeholder visible rather than dropping it', () => {
        expect(renderReminderTemplate('Hi {{name}}, {{nonsense}}', { name: 'Nadia' })).toBe(
            'Hi Nadia, {{nonsense}}',
        );
    });
});

describe('stats', () => {
    test('counts appointments and money for a period', async () => {
        const { branch, patient, rootCanal } = await fixtures();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
        });
        const visit = await visitService.checkIn({ appointmentId: appointment.id });
        await visitService.checkOut({
            visitId: visit.id,
            chargedTotal: 100_000,
            paidTotal: 100_000,
            method: 'cash',
        });

        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

        const summary = await statsService.summary({ from: today, to: tomorrow, offsetMinutes: 0 });

        expect(summary.appointments.total).toBe(1);
        expect(summary.appointments.completed).toBe(1);
        expect(summary.visits.charged).toBe(100_000);
        expect(summary.visits.collected).toBe(100_000);
        expect(summary.topProcedures[0]?.name).toBe('Root canal');
    });
});
