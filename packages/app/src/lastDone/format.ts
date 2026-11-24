import { type Locale, localizeCopy } from '@lustre/shared';
import { formatStamp, formatTime12 } from '../components/domain/clock';
import { formatMoney } from '../components/domain/money';
import { dateKey, formatDate } from '../screens/day/time';
import type { LastDoneDetail, LastDoneEntry, LastDoneKind } from './entry';

export const TITLE: Record<LastDoneKind, string> = {
    book: 'Booked appointment',
    move: 'Moved appointment',
    cancel: 'Cancelled appointment',
    noShow: 'Marked no-show',
    checkIn: 'Checked in',
    finish: 'Finished visit',
    procedures: 'Saved procedures',
    payment: 'Recorded payment',
    paymentFix: 'Corrected payment',
    addPatient: 'Added patient',
    editPatient: 'Edited patient',
    oldVisit: 'Added old visit',
};

const SHORT: Record<LastDoneKind, string> = {
    book: 'Booked',
    move: 'Moved',
    cancel: 'Cancelled',
    noShow: 'No-show',
    checkIn: 'Arrived',
    finish: 'Finished',
    procedures: 'Treated',
    payment: 'Payment',
    paymentFix: 'Payment',
    addPatient: 'Added',
    editPatient: 'Edited',
    oldVisit: 'Old visit',
};

export function buttonLabel(entry: LastDoneEntry, locale: Locale): { said: string; name: string | null } {
    const first = entry.patientName?.trim().split(/\s+/)[0];
    return { said: localizeCopy(locale, SHORT[entry.kind]), name: first || null };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function whenText(at: number, now: number, locale: Locale): string {
    const elapsed = now - at;
    if (elapsed < MINUTE) return localizeCopy(locale, 'Just now');
    if (elapsed < HOUR) return localizeCopy(locale, '{minutes}m', { minutes: Math.floor(elapsed / MINUTE) });
    return formatStamp(at, locale);
}

function comma(locale: Locale): string {
    return locale === 'ar' ? '، ' : ', ';
}

function slot(startsAt: string, locale: Locale): string {
    return `${formatDate(dateKey(startsAt))}${comma(locale)}${formatTime12(startsAt, locale)}`;
}

function arrow(locale: Locale): string {
    return locale === 'ar' ? '←' : '→';
}

function move(from: string | null, to: string, locale: Locale): string {
    if (from === null) return `${arrow(locale)} ${slot(to, locale)}`;
    const sameDay = dateKey(from) === dateKey(to);
    return sameDay
        ? `${formatDate(dateKey(to))}${comma(locale)}${formatTime12(from, locale)} ${arrow(locale)} ${formatTime12(to, locale)}`
        : `${formatDate(dateKey(from))} ${arrow(locale)} ${formatDate(dateKey(to))}`;
}

function detailText(detail: LastDoneDetail | null, locale: Locale, showMoney: boolean): string | null {
    if (detail === null) return null;
    switch (detail.type) {
        case 'slot':
            return slot(detail.startsAt, locale);
        case 'move':
            return move(detail.from, detail.to, locale);
        case 'amount':
            return showMoney ? formatMoney(detail.amount, { language: locale }) : null;
        case 'procedure': {
            const first = detail.tooth ? `${detail.name} — ${detail.tooth}` : detail.name;
            return detail.more > 0 ? `${first} +${detail.more}` : first;
        }
        case 'day':
            return formatDate(detail.date);
        case 'phone':
            return detail.phone;
        case 'walkIn':
            return localizeCopy(locale, 'Walk-in');
    }
}

export function subline(entry: LastDoneEntry, locale: Locale, showMoney: boolean): string {
    return [entry.patientName, detailText(entry.detail, locale, showMoney)]
        .filter((part): part is string => Boolean(part))
        .join(' · ');
}

export interface DayGroup {
    key: string;
    entries: LastDoneEntry[];
}

export function byDay(entries: readonly LastDoneEntry[]): DayGroup[] {
    const groups: DayGroup[] = [];
    for (const entry of entries) {
        const key = dateKey(entry.at);
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.entries.push(entry);
        else groups.push({ key, entries: [entry] });
    }
    return groups;
}
