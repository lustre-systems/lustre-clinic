import type { Locale } from './enums.ts';

export interface BilingualLabel {
    label: string;
    labelAr?: string | null;
}

export function resolveLabel({ label, labelAr }: BilingualLabel, locale: Locale): string {
    const en = label.trim();
    const ar = labelAr?.trim() ?? '';
    return locale === 'ar' ? ar || en : en || ar;
}
