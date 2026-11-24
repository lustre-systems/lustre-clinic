import { ERROR_CODE, type Tooth } from '@lustre/shared';
import { AppError } from '../../errors/AppError.ts';
import { settingsService } from '../settings/settings.service.ts';
import { type Procedure, procedureService } from './procedure.service.ts';

export interface RequestedLine {
    procedureId: string;
    quantity: number;
    tooth?: Tooth | null;
    note?: string | null;
}

export interface ResolvedLine {
    procedure: Procedure;
    quantity: number;
    tooth: Tooth | null;
    note: string | null;
}

export async function resolveProcedureLines(lines: RequestedLine[]): Promise<ResolvedLine[]> {
    const [clinicType, ...procedures] = await Promise.all([
        settingsService.clinicType(),
        ...lines.map((line) => procedureService.requireSelectable(line.procedureId)),
    ]);

    const seen = new Set<string>();

    return lines.map((line, i) => {
        const procedure = procedures[i];
        if (!procedure) throw AppError.internal('procedure resolution returned nothing');
        const tooth = line.tooth ?? null;

        if (procedure.isToothSpecific && !tooth && clinicType === 'dental') {
            throw new AppError(
                ERROR_CODE.TOOTH_REQUIRED,
                'that procedure must name the tooth it was done on',
                422,
            );
        }
        if (!procedure.isToothSpecific && tooth) {
            throw new AppError(
                ERROR_CODE.TOOTH_NOT_APPLICABLE,
                'that procedure is not done on a specific tooth',
                422,
            );
        }

        if (!procedure.hasQuantity) {
            const key = `${procedure.id}:${tooth ?? ''}`;
            if (seen.has(key)) {
                throw new AppError(
                    ERROR_CODE.PROCEDURE_DUPLICATE,
                    tooth
                        ? 'that procedure may appear only once per tooth'
                        : 'that procedure may appear only once',
                    422,
                );
            }
            seen.add(key);
            if (line.quantity !== 1) {
                throw new AppError(ERROR_CODE.VALIDATION, 'that procedure does not take a quantity', 422);
            }
        }

        return { procedure, quantity: line.quantity, tooth, note: line.note ?? null };
    });
}
