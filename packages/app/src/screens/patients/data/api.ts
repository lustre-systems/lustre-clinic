import { errorCodeOf, isOffline, trpcClient } from '../../../api';
import type { PatientRequirements } from '../../../components/domain/patientDraft';
import { arrivalQueue } from '../../day/chair';
import { checkInTimes, api as dayApi } from '../../day/data';
import { clinicOffsetNow, todayKey } from '../../day/time';
import { PatientsRequestError } from './requestError';
import type {
    AddedOldVisit,
    AddOldVisitInput,
    CreatePatientInput,
    CustomQuestion,
    Patient,
    PatientBalance,
    PatientDetail,
    RecentPatients,
    RefEdit,
    SettleInput,
    SettleReport,
    UpdatePatientInput,
    UpdatePatientRefInput,
} from './types';

function shaped<T>(value: unknown): T {
    return value as T;
}

async function wrap<T>(run: () => Promise<unknown>): Promise<T> {
    try {
        return shaped<T>(await run());
    } catch (err) {
        if (err instanceof PatientsRequestError) throw err;
        throw new PatientsRequestError(
            errorCodeOf(err),
            err instanceof Error ? err.message : 'request failed',
            { offline: isOffline(err), cause: err },
        );
    }
}

function optionsOf(value: unknown): string[] | null {
    return Array.isArray(value) ? (value as string[]) : null;
}

export async function chairToday(appointmentId: string): Promise<string | null> {
    const rows = await dayApi.byDate(todayKey());
    const branchId = rows.find((row) => row.id === appointmentId)?.branchId;
    if (branchId === undefined) return null;

    const branch = rows.filter((row) => row.branchId === branchId);
    const arrived = branch.filter((row) => row.status === 'checked_in').map((row) => row.id);
    const { checkedInAt } = await checkInTimes(arrived);
    return arrivalQueue(branch, checkedInAt).chair?.id ?? null;
}

export const PAGE_SIZE = 50;

interface OutstandingRow {
    patientId: string;
    balance: number;
}

export const patientsApi = {
    listBranches: () => dayApi.branches(),

    schedule: () => dayApi.schedule(),

    async requirements(): Promise<PatientRequirements> {
        const settings = await wrap<PatientRequirements>(() => trpcClient.settings.get.query());
        return { requireAge: settings.requireAge, requireGender: settings.requireGender };
    },

    async listQuestions(): Promise<CustomQuestion[]> {
        const rows = await wrap<Array<Omit<CustomQuestion, 'options'> & { options: unknown }>>(() =>
            trpcClient.customQuestion.list.query({ includeInactive: false }),
        );
        return rows.map((row) => ({ ...row, options: optionsOf(row.options) }));
    },

    search(q: string, offset = 0, limit = PAGE_SIZE): Promise<Patient[]> {
        return wrap(() => trpcClient.patient.search.query({ q: q.trim(), limit, offset }));
    },

    recent(offset = 0, order: 'newest' | 'name' = 'newest', limit = PAGE_SIZE): Promise<RecentPatients> {
        return wrap(() => trpcClient.patient.recent.query({ order, limit, offset }));
    },

    byId(id: string): Promise<PatientDetail> {
        return wrap(() => trpcClient.patient.byId.query({ id }));
    },

    async outstanding(patientIds: string[]): Promise<PatientBalance[]> {
        const report = await wrap<{ patients: OutstandingRow[] }>(() =>
            trpcClient.balance.outstanding.query({ patientIds }),
        );
        return report.patients.map((row) => ({ patientId: row.patientId, balance: row.balance }));
    },

    create(input: CreatePatientInput): Promise<Patient> {
        return wrap(() => trpcClient.patient.create.mutate(input));
    },

    update(input: UpdatePatientInput): Promise<Patient> {
        return wrap(() => trpcClient.patient.update.mutate(input));
    },

    updateRef(input: UpdatePatientRefInput): Promise<Patient> {
        return wrap(() => trpcClient.patient.updateRef.mutate(input));
    },

    refHistory(id: string): Promise<RefEdit[]> {
        return wrap(() => trpcClient.patient.refHistory.query({ id }));
    },

    addOldVisit(input: AddOldVisitInput): Promise<AddedOldVisit> {
        return wrap(() =>
            trpcClient.procedure.addOldVisit.mutate({ ...input, offsetMinutes: clinicOffsetNow() }),
        );
    },

    async delete(id: string): Promise<true> {
        await wrap(() => trpcClient.patient.delete.mutate({ id }));
        return true;
    },

    settle(input: SettleInput): Promise<SettleReport> {
        return wrap(() => trpcClient.balance.settle.mutate(input));
    },
};
