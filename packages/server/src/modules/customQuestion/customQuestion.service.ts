import { ERROR_CODE, WS_EVENT } from '@lustre/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { customQuestions } from '../../db/schema.ts';
import { AppError, PG_ERROR, pgErrorCode } from '../../errors/AppError.ts';
import { broadcast } from '../../ws/index.ts';
import type {
    CreateCustomQuestionInput,
    ListCustomQuestionInput,
    ReorderCustomQuestionsInput,
    UpdateCustomQuestionInput,
} from './customQuestion.schema.ts';

type CustomQuestion = typeof customQuestions.$inferSelect;

export type Answers = Record<string, unknown>;

export type QuestionnaireGapReason = 'unanswered' | 'answer_no_longer_valid';

export interface QuestionnaireGap {
    key: string;
    label: string;
    labelAr: string | null;
    required: boolean;
    reason: QuestionnaireGapReason;
}

function optionsOf(question: CustomQuestion): string[] {
    return Array.isArray(question.options) ? (question.options as string[]) : [];
}

export const customQuestionService = {
    async list(input: ListCustomQuestionInput = { includeInactive: false }): Promise<CustomQuestion[]> {
        const rows = await db
            .select()
            .from(customQuestions)
            .orderBy(asc(customQuestions.sortOrder), asc(customQuestions.label));

        return input.includeInactive ? rows : rows.filter((q) => q.active);
    },

    async create(input: CreateCustomQuestionInput): Promise<CustomQuestion> {
        try {
            const [row] = await db
                .insert(customQuestions)
                .values({
                    id: Bun.randomUUIDv7(),
                    key: input.key,
                    label: input.label,
                    labelAr: input.labelAr ?? null,
                    kind: input.kind,
                    options: input.kind === 'select' ? (input.options ?? []) : null,
                    required: input.required,
                    sortOrder: input.sortOrder,
                })
                .returning();

            if (!row) throw AppError.internal('custom question insert returned nothing');
            broadcast(WS_EVENT.CATALOG_UPDATED, { id: row.id });
            return row;
        } catch (err) {
            if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
                throw new AppError(ERROR_CODE.DUPLICATE_KEY, 'that question key is already in use', 409, {
                    cause: err,
                });
            }
            throw err;
        }
    },

    async update({ id, ...patch }: UpdateCustomQuestionInput): Promise<CustomQuestion> {
        const [row] = await db
            .update(customQuestions)
            .set(patch)
            .where(eq(customQuestions.id, id))
            .returning();

        if (!row) throw AppError.notFound('custom question');
        broadcast(WS_EVENT.CATALOG_UPDATED, { id });
        return row;
    },

    async reorder({ ids }: ReorderCustomQuestionsInput): Promise<void> {
        if (new Set(ids).size !== ids.length) {
            throw new AppError(ERROR_CODE.VALIDATION, 'the same question appears twice in the order', 422);
        }

        await db.transaction(async (tx) => {
            const rows = await tx
                .select({ id: customQuestions.id })
                .from(customQuestions)
                .where(inArray(customQuestions.id, ids));

            if (rows.length !== ids.length) throw AppError.notFound('custom question');

            for (const [index, id] of ids.entries()) {
                await tx.update(customQuestions).set({ sortOrder: index }).where(eq(customQuestions.id, id));
            }
        });
        broadcast(WS_EVENT.CATALOG_UPDATED);
    },

    async byKey(): Promise<Map<string, CustomQuestion>> {
        const rows = await this.list({ includeInactive: true });
        return new Map(rows.map((question) => [question.key, question]));
    },

    async validateIntake(answers: Answers): Promise<Answers> {
        const questions = await this.byKey();
        const result = checkSubmitted(answers, questions);

        for (const question of questions.values()) {
            const answered = question.key in result;
            if (question.active && question.required && !answered) throw missingAnswer(question);
        }

        return result;
    },

    async validatePatch(stored: Answers, patch: Answers): Promise<Answers> {
        const questions = await this.byKey();
        const edits = checkSubmitted(patch, questions);
        const result: Answers = { ...stored };

        for (const key of Object.keys(patch)) {
            if (key in edits) result[key] = edits[key];
            else delete result[key];
        }

        return result;
    },

    async auditAnswers(stored: Answers): Promise<QuestionnaireGap[]> {
        const questions = await this.list();
        const gaps: QuestionnaireGap[] = [];

        for (const question of questions) {
            const value = stored[question.key];
            const reason = gapIn(question, value);
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

function gapIn(question: CustomQuestion, value: unknown): QuestionnaireGapReason | null {
    if (isBlank(value)) return 'unanswered';

    try {
        coerce(question, value);
        return null;
    } catch {
        return 'answer_no_longer_valid';
    }
}

function checkSubmitted(submitted: Answers, questions: Map<string, CustomQuestion>): Answers {
    const result: Answers = {};

    for (const [key, value] of Object.entries(submitted)) {
        const question = questions.get(key);
        if (!question) {
            throw new AppError(ERROR_CODE.VALIDATION, `no custom question has the key '${key}'`, 422);
        }

        if (isBlank(value)) {
            if (question.active && question.required) throw missingAnswer(question);
            continue;
        }

        result[key] = coerce(question, value);
    }

    return result;
}

function isBlank(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

function coerce(question: CustomQuestion, value: unknown): unknown {
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
            const options = optionsOf(question);
            if (typeof value !== 'string' || !options.includes(value)) {
                throw wrongKind(question, 'one of its options');
            }
            return value;
        }
    }
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
    if (!CALENDAR_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function wrongKind(question: CustomQuestion, expected: string): AppError {
    return new AppError(ERROR_CODE.VALIDATION, `custom question '${question.key}' expects ${expected}`, 422);
}

function missingAnswer(question: CustomQuestion): AppError {
    return new AppError(
        ERROR_CODE.CUSTOM_QUESTION_REQUIRED,
        `custom question '${question.key}' is required`,
        422,
    );
}
