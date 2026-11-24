import { ERROR_CODE, MAX_AMOUNT_PIASTRES } from '@lustre/shared';
import { AppError } from '../errors/AppError.ts';

export function assertAmount(amount: number, what = 'amount'): number {
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT_PIASTRES) {
        throw new AppError(ERROR_CODE.INVALID_AMOUNT, `${what} is out of range`, 422);
    }
    return amount;
}

export interface PricedLine {
    unitPrice: number;
    quantity: number;
    isCheckup: boolean;
}

export function computeTotal(lines: readonly PricedLine[]): number {
    const hasOther = lines.some((line) => !line.isCheckup);
    const counted = hasOther ? lines.filter((line) => !line.isCheckup) : lines;

    return counted.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}
