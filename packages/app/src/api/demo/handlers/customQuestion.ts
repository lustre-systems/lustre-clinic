import { ERROR_CODE } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { type CustomQuestionRow, getDb, save } from '../db';
import { assignDefined, DemoError, uuidv7 } from '../rules';
import type { Dated } from '../wire';

type CustomQuestion = Dated<RouterOutput['customQuestion']['list'][number]>;
export type Answers = Record<string, unknown>;
type QuestionnaireGap = Dated<RouterOutput['patient']['byId']['questionnaireGaps'][number]>;
type GapReason = QuestionnaireGap['reason'];

function sorted(rows: readonly CustomQuestionRow[]): CustomQuestionRow[] {
    return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

function optionsOf(question: CustomQuestionRow): string[] {
    return Array.isArray(question.options) ? (question.options as string[]) : [];
}

function isBlank(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
    if (!CALENDAR_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function wrongKind(question: CustomQuestionRow, expected: string): DemoError {
    return new DemoError(ERROR_CODE.VALIDATION, `custom question '${question.key}' expects ${expected}`, 422);
}

function missingAnswer(question: CustomQuestionRow): DemoError {
    return new DemoError(
        ERROR_CODE.CUSTOM_QUESTION_REQUIRED,
        `custom question '${question.key}' is required`,
        422,
    );
}

function coerce(question: CustomQuestionRow, value: unknown): unknown {
    switch (question.kind) {
        case 'text':
            if (typeof value !== 'string') throw wrongKind(question, 'a string');
            return value;

        case 'number': {
            const n = typeof value === 'string' ? Number(value) : value;
            if (typeof n !== 'number' || !Number.isFinite(n)) throw wrongKind(question, 'a number');
            return n;
        }

        case 'boolean':
            if (typeof value !== 'boolean') throw wrongKind(question, 'a boolean');
            return value;

        case 'date':
            if (typeof value !== 'string' || !isCalendarDate(value)) {
                throw wrongKind(question, 'a YYYY-MM-DD date');
            }
            return value;

        case 'select': {
            if (typeof value !== 'string' || !optionsOf(question).includes(value)) {
                throw wrongKind(question, 'one of its options');
            }
            return value;
        }
    }
}

function byKey(): Map<string, CustomQuestionRow> {
    return new Map(getDb().customQuestions.map((question) => [question.key, question]));
}

function checkSubmitted(submitted: Answers, questions: Map<string, CustomQuestionRow>): Answers {
    const result: Answers = {};

    for (const [key, value] of Object.entries(submitted)) {
        const question = questions.get(key);
        if (!question) {
            throw new DemoError(ERROR_CODE.VALIDATION, `no custom question has the key '${key}'`, 422);
        }

        if (isBlank(value)) {
            if (question.active && question.required) throw missingAnswer(question);
            continue;
        }

        result[key] = coerce(question, value);
    }

    return result;
}

function gapIn(question: CustomQuestionRow, value: unknown): GapReason | null {
    if (isBlank(value)) return 'unanswered';

    try {
        coerce(question, value);
        return null;
    } catch {
        return 'answer_no_longer_valid';
    }
}

export const customQuestionHandlers = {
    list(input: RouterInput['customQuestion']['list']): CustomQuestion[] {
        const rows = sorted(getDb().customQuestions);
        return input?.includeInactive ? rows : rows.filter((row) => row.active);
    },

    create(input: RouterInput['customQuestion']['create']): CustomQuestion {
        if (getDb().customQuestions.some((question) => question.key === input.key)) {
            throw new DemoError(ERROR_CODE.DUPLICATE_KEY, 'that question key is already in use', 409);
        }

        const row: CustomQuestionRow = {
            id: uuidv7(),
            key: input.key,
            label: input.label,
            labelAr: input.labelAr ?? null,
            kind: input.kind,
            options: input.kind === 'select' ? (input.options ?? []) : null,
            required: input.required ?? false,
            sortOrder: input.sortOrder ?? 0,
            active: true,
        };

        getDb().customQuestions.push(row);
        save();
        return row;
    },

    update(input: RouterInput['customQuestion']['update']): CustomQuestion {
        const { id, ...patch } = input;
        const row = getDb().customQuestions.find((question) => question.id === id);
        if (!row) throw DemoError.notFound('custom question');

        assignDefined(row, patch);
        save();
        return row;
    },

    reorder(input: RouterInput['customQuestion']['reorder']): void {
        const { ids } = input;

        if (new Set(ids).size !== ids.length) {
            throw new DemoError(ERROR_CODE.VALIDATION, 'the same question appears twice in the order', 422);
        }

        const rows = ids.map((id) => {
            const row = getDb().customQuestions.find((question) => question.id === id);
            if (!row) throw DemoError.notFound('custom question');
            return row;
        });

        for (const [index, row] of rows.entries()) row.sortOrder = index;
        save();
    },

    validateIntake(answers: Answers): Answers {
        const questions = byKey();
        const result = checkSubmitted(answers, questions);

        for (const question of questions.values()) {
            if (question.active && question.required && !(question.key in result)) {
                throw missingAnswer(question);
            }
        }

        return result;
    },

    validatePatch(stored: Answers, patch: Answers): Answers {
        const edits = checkSubmitted(patch, byKey());
        const result: Answers = { ...stored };

        for (const key of Object.keys(patch)) {
            if (key in edits) result[key] = edits[key];
            else delete result[key];
        }

        return result;
    },

    auditAnswers(stored: Answers): QuestionnaireGap[] {
        const gaps: QuestionnaireGap[] = [];

        for (const question of sorted(getDb().customQuestions).filter((row) => row.active)) {
            const reason = gapIn(question, stored[question.key]);
            if (!reason) continue;

            gaps.push({
                key: question.key,
                label: question.label,
                labelAr: question.labelAr,
                required: question.required,
                reason,
            });
        }

        return gaps;
    },
};
