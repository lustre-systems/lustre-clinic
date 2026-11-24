export function sentenceCase(value: string | null): string | null {
    if (!value) return null;
    return value.charAt(0).toUpperCase() + value.slice(1);
}
