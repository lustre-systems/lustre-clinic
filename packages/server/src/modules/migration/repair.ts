import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { patients, settings } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { settingsService } from '../settings/settings.service.ts';

export type RepairVerdict = 'repairable' | 'taken' | 'reserved';

export interface RepairRow {
    patientId: string;
    ref: string;
    oldRef: string;
    verdict: RepairVerdict;
}

export interface RepairReport {
    applied: boolean;
    rows: RepairRow[];
    repairable: number;
    taken: number;
    reserved: number;
}

export async function repairPatientRefs({ apply }: { apply: boolean }): Promise<RepairReport> {
    await settingsService.ensureSeeded();

    return db.transaction(async (tx) => {
        const [counter] = await tx
            .select({ next: settings.patientRefNext })
            .from(settings)
            .where(eq(settings.id, 1))
            .for('update');

        if (!counter) throw AppError.internal('settings row could not be read');

        const all = await tx
            .select({ id: patients.id, ref: patients.ref, legacyRef: patients.legacyRef })
            .from(patients)
            .orderBy(patients.createdAt);

        const taken = new Set(all.map((row) => row.ref));
        const rows: RepairRow[] = [];

        for (const row of all) {
            if (row.legacyRef === null || row.legacyRef === row.ref) continue;
            const oldRef = row.legacyRef;

            const verdict: RepairVerdict = taken.has(oldRef)
                ? 'taken'
                : /^\d+$/.test(oldRef) && Number(oldRef) >= counter.next
                  ? 'reserved'
                  : 'repairable';

            if (verdict === 'repairable' && apply) {
                await tx.update(patients).set({ ref: oldRef }).where(eq(patients.id, row.id));
                taken.delete(row.ref);
            }

            if (verdict === 'repairable') taken.add(oldRef);

            rows.push({ patientId: row.id, ref: row.ref, oldRef, verdict });
        }

        return {
            applied: apply,
            rows,
            repairable: rows.filter((row) => row.verdict === 'repairable').length,
            taken: rows.filter((row) => row.verdict === 'taken').length,
            reserved: rows.filter((row) => row.verdict === 'reserved').length,
        };
    });
}
