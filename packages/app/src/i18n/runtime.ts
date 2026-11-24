import type { Locale } from '@lustre/shared';

let runtimeLocale: Locale = 'en';

export function getLocale(): Locale {
    return runtimeLocale;
}

export function setRuntimeLocale(locale: Locale): void {
    runtimeLocale = locale;
}
