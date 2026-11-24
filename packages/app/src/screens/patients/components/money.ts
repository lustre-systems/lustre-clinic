import { localizeCopy, PIASTRES_PER_POUND } from '@lustre/shared';
import { formatMoney, toPounds } from '../../../components/domain/money';
import { getLocale } from '../../../i18n/runtime';

export { formatMoney, toPounds };

export function isWholePounds(text: string): boolean {
    return /^[0-9]*$/.test(text);
}

export function clampToOutstanding(enteredPounds: number, outstanding: number): number {
    if (!Number.isFinite(enteredPounds) || enteredPounds <= 0) return 0;
    return Math.max(0, Math.min(Math.trunc(enteredPounds) * PIASTRES_PER_POUND, outstanding));
}

const METHOD_LABEL: Record<string, string> = {
    cash: 'Cash',
    visa: 'Card',
    instapay: 'Instapay',
    other: 'Other',
};

export function methodLabel(method: string): string {
    return METHOD_LABEL[method] ?? 'Other';
}

export function paymentReceipt(report: { amount: number; outstandingAfter: number }): string {
    const locale = getLocale();
    const amount = formatMoney(report.amount, { language: locale });

    return report.outstandingAfter <= 0
        ? localizeCopy(locale, '{amount} recorded — paid in full', { amount })
        : localizeCopy(locale, '{amount} recorded — {balance} still owed', {
              amount,
              balance: formatMoney(report.outstandingAfter, { language: locale }),
          });
}
