import type { CustomQuestion, QuestionKind } from '../data/types';

const EDITABLE_KINDS = ['text', 'number', 'boolean', 'select'] as const;

export type EditableKind = (typeof EDITABLE_KINDS)[number];

export function isEditable(question: CustomQuestion): question is CustomQuestion & { kind: EditableKind } {
    return (EDITABLE_KINDS as readonly QuestionKind[]).includes(question.kind);
}

export const YES = 'true';
export const NO = 'false';

export type DraftValue = string;

export type Draft = Record<string, DraftValue>;

export function toDraft(question: CustomQuestion, stored: unknown): DraftValue {
    if (question.kind === 'boolean') {
        if (stored === true) return YES;
        if (stored === false) return NO;
        return '';
    }
    if (stored === undefined || stored === null) return '';
    return String(stored);
}

export function fromDraft(question: CustomQuestion, draft: DraftValue): unknown {
    const trimmed = draft.trim();
    if (trimmed === '') return '';

    if (question.kind === 'boolean') return trimmed === YES;
    if (question.kind === 'number') {
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : trimmed;
    }
    return trimmed;
}

export function isAnswered(draft: DraftValue): boolean {
    return draft.trim() !== '';
}

export function displayAnswer(question: CustomQuestion, stored: unknown): string | null {
    if (stored === undefined || stored === null || stored === '') return null;

    switch (question.kind) {
        case 'boolean':
            return stored === true ? 'Yes' : 'No';
        case 'number':
        case 'text':
        case 'select':
        case 'date':
            return String(stored);
    }
}

export function isReadOnly(question: CustomQuestion): boolean {
    return !isEditable(question);
}
