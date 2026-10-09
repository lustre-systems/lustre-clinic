/**
 * The payment screen's field and its Full / Half / Nothing chips. On a
 * correction the field is everything paid on the visit, so the chips have to
 * reach every state of the bill from any other — the bug was that on a visit
 * already paid in full they all landed on the figure already there. The
 * screen's wiring is held at the source level, as in `finish.test.ts`: there is
 * no renderer under `bun test`.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { alreadyPaidBy, paidBy, paidEntry, quickAmounts, typedEntry } from './money';

const CHARGED = 600_000;

describe('the quick amounts', () => {
    // A correction's ceiling is the whole charge, so nothing collected before
    // enters into it: three different figures, on a paid visit as on an unpaid one.
    it('are paid in full, half paid and unpaid on a correction', () => {
        const { full, half, nothing } = quickAmounts(CHARGED);
        expect({ full, half, nothing }).toEqual({ full: CHARGED, half: CHARGED / 2, nothing: 0 });
        expect(new Set([full, half, nothing]).size).toBe(3);
    });

    it('lets a visit paid in full be corrected down to half and to nothing', () => {
        const collected = CHARGED;
        const { half, nothing } = quickAmounts(CHARGED);

        // What `setPaid` is then asked to make the total, and so the delta it writes.
        expect(half - collected).toBe(-CHARGED / 2);
        expect(nothing - collected).toBe(-CHARGED);
    });

    it('takes unpaid → partial → paid in three taps', () => {
        let collected = 0;
        for (const chip of ['half', 'full'] as const) {
            const next = quickAmounts(CHARGED)[chip];
            expect(next).toBeGreaterThan(collected);
            collected = next;
        }
        expect(collected).toBe(CHARGED);
    });

    it('are shares of what is still due at the desk', () => {
        const due = CHARGED - 100_000;
        expect(quickAmounts(due)).toEqual({ full: due, half: due / 2, nothing: 0 });
    });

    it('keep exact piastres, so Full never rounds past the charge', () => {
        expect(quickAmounts(12_050)).toEqual({ full: 12_050, half: 6_025, nothing: 0 });
    });

    it('offer nothing but zero against nothing', () => {
        expect(quickAmounts(0)).toEqual({ full: 0, half: 0, nothing: 0 });
        expect(quickAmounts(-500)).toEqual({ full: 0, half: 0, nothing: 0 });
    });
});

describe('the paid field', () => {
    it('shows whole pounds and records the exact figure it was opened on', () => {
        expect(paidEntry(12_050)).toEqual({ text: '121', piastres: 12_050 });
        expect(paidEntry(0)).toEqual({ text: '0', piastres: 0 });
    });

    it('reads typed pounds as piastres', () => {
        expect(typedEntry('3000', CHARGED)).toEqual({
            entry: { text: '3000', piastres: 300_000 },
            capped: false,
        });
        expect(typedEntry('', CHARGED)).toEqual({ entry: { text: '', piastres: 0 }, capped: false });
        expect(typedEntry('12.5', CHARGED).entry.piastres).toBe(12_500);
    });

    it('caps at the ceiling to the piastre and says so', () => {
        expect(typedEntry('9000', CHARGED)).toEqual({ entry: paidEntry(CHARGED), capped: true });
        // 121 pounds over a 120.50 charge is fifty piastres too many.
        expect(typedEntry('121', 12_050)).toEqual({ entry: { text: '121', piastres: 12_050 }, capped: true });
    });

    it('takes the ceiling itself without complaint', () => {
        expect(typedEntry('6000', CHARGED).capped).toBe(false);
    });
});

describe('the payment screen', () => {
    const source = Bun.file(path.join(import.meta.dir, 'components/VisitPaymentScreen.tsx')).text();

    it('draws its chips from quickAmounts against the ceiling', async () => {
        const text = await source;
        expect(text).toContain('quickAmounts(ceiling)');
        expect(text).toContain('choose(quick.full)');
        expect(text).toContain('choose(quick.half)');
        expect(text).toContain('choose(quick.nothing)');
    });

    it('measures a correction against the whole charge', async () => {
        expect(await source).toContain('const ceiling = correcting ? charged : due;');
    });

    it('records the field’s exact piastres, not the pounds it shows', async () => {
        expect(await source).toContain('const paidPiastres = entry.piastres;');
    });
});

describe('how a visit was paid', () => {
    const row = (amount: number, method: string, methodNote: string | null = null) => ({
        amount,
        method,
        methodNote,
    });

    it('nets each method over its corrections, largest first', () => {
        expect(
            paidBy([row(90_000, 'cash'), row(-90_000, 'cash'), row(90_000, 'visa'), row(10_000, 'instapay')]),
        ).toEqual([
            { method: 'visa', methodNote: null, amount: 90_000 },
            { method: 'instapay', methodNote: null, amount: 10_000 },
        ]);
    });

    it('is nothing when nothing is paid, or when it was all given back', () => {
        expect(paidBy([])).toEqual([]);
        expect(paidBy([row(50_000, 'cash'), row(-50_000, 'cash')])).toEqual([]);
    });

    it('tells one other method from another by its note, and reads an unknown method as other', () => {
        expect(
            paidBy([row(30_000, 'other', 'Bank transfer'), row(20_000, 'other', ' Vodafone Cash ')]),
        ).toEqual([
            { method: 'other', methodNote: 'Bank transfer', amount: 30_000 },
            { method: 'other', methodNote: 'Vodafone Cash', amount: 20_000 },
        ]);
        expect(paidBy([row(5_000, 'cheque', 'No. 12')])[0]?.method).toBe('other');
    });

    it('restates only what is not already all in the chosen method', () => {
        const card = paidBy([row(90_000, 'visa')]);
        expect(alreadyPaidBy(card, 'visa', '')).toBe(true);
        expect(alreadyPaidBy(card, 'cash', '')).toBe(false);

        // A split payment folds onto either of its own methods.
        const split = paidBy([row(50_000, 'cash'), row(40_000, 'visa')]);
        expect(alreadyPaidBy(split, 'cash', '')).toBe(false);

        const other = paidBy([row(90_000, 'other', 'Bank transfer')]);
        expect(alreadyPaidBy(other, 'other', ' Bank transfer ')).toBe(true);
        expect(alreadyPaidBy(other, 'other', 'Vodafone Cash')).toBe(false);
    });
});

describe('the payment screen, restating the method', () => {
    const source = Bun.file(path.join(import.meta.dir, 'components/VisitPaymentScreen.tsx')).text();

    it('opens a correction on how the visit was actually paid', async () => {
        const text = await source;
        expect(text).toContain("useState<PaymentMethod>(() => held[0]?.method ?? 'cash')");
    });

    it('keeps the methods usable on an unchanged correction, and restates only on a pick', async () => {
        const text = await source;
        expect(text).toContain('const restatable = correcting && !moves && held.length > 0;');
        expect(text).toContain(
            'const restating = restatable && picked && !alreadyPaidBy(held, method, methodNote);',
        );
        expect(text).toContain("pointerEvents={moves || restatable ? 'auto' : 'none'}");
        expect(text).toContain('setPaidMethod.mutate(');
    });
});
