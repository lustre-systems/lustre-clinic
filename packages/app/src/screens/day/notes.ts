export function noteDraft(note: string | null | undefined): string {
    return note ?? '';
}

export function noteValue(draft: string): string | null {
    return draft.trim() || null;
}

export function noteChanged(original: string | null | undefined, draft: string): boolean {
    return noteValue(draft) !== noteValue(original ?? '');
}
