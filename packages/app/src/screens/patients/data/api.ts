/**
 * Every call this cluster makes, over the real tRPC client. It replaces
 * `_LocalPatientsApi` (BLOCKED.md §1 — F2 has landed, `src/api` exists), and
 * keeps that module's method names and shapes so the two screens changed one
 * import and nothing else.
 *
 * Two things are done by hand, as in `screens/day/data/day.ts`: dates arrive as
 * ISO strings while the inferred types still say `Date` — `shaped`/`types.ts`
 * bridge that until a transformer lands — and `wrap` turns a tRPC failure into
 * the `ErrorCode` the screens localize from, never a parsed message.
 *
 * `options` is a `jsonb` column, so it arrives as `unknown` and is read the way
 * the server's own `optionsOf` reads it: an array or nothing. `outstanding`
 * takes the report's per-patient rows only — the list wants a balance per
 * patient, and the clinic-wide total belongs to the money cluster.
 */
import { errorCodeOf, isOffline, trpcClient } from '../../../api';
import type { PatientRequirements } from '../../../components/domain/patientDraft';
// By file, not through `../../day`: that barrel mounts screens that open this
// cluster, and the queue rule is all this needs.
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

/** The `jsonb` column reaches the client as `unknown`; a select's options are an array or nothing. */
function optionsOf(value: unknown): string[] | null {
    return Array.isArray(value) ? (value as string[]) : null;
}

/**
 * Who is in the chair today at the branch this appointment is booked in, read
 * the way the day view reads it: today's rows for that branch, ordered by
 * arrival (`arrivalQueue`). A record's history row carries the status and not
 * the queue, and `checked_in` alone cannot tell the chair from the waiting room.
 */
export async function chairToday(appointmentId: string): Promise<string | null> {
    const rows = await dayApi.byDate(todayKey());
    const branchId = rows.find((row) => row.id === appointmentId)?.branchId;
    if (branchId === undefined) return null;

    const branch = rows.filter((row) => row.branchId === branchId);
    const arrived = branch.filter((row) => row.status === 'checked_in').map((row) => row.id);
    const { checkedInAt } = await checkInTimes(arrived);
    return arrivalQueue(branch, checkedInAt).chair?.id ?? null;
}

/** Rows per `search`/`recent` call. The server takes at most 100. */
export const PAGE_SIZE = 50;

interface OutstandingRow {
    patientId: string;
    balance: number;
}

export const patientsApi = {
    /** Active only: the WhatsApp button offers one per branch the clinic still works from. */
    listBranches: () => dayApi.branches(),

    schedule: () => dayApi.schedule(),

    /** Whether the clinic requires an age and a sex on a record (Settings → Patient fields). */
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

    /**
     * An empty term is not a browse: `patient.search` answers `[]` for one, by
     * design. Browsing is `recent`, which the list calls instead of searching
     * for nothing.
     */
    search(q: string, offset = 0, limit = PAGE_SIZE): Promise<Patient[]> {
        return wrap(() => trpcClient.patient.search.query({ q: q.trim(), limit, offset }));
    },

    /** Newest first, plus the size of the whole register for the heading's count. */
    recent(offset = 0, limit = PAGE_SIZE): Promise<RecentPatients> {
        return wrap(() => trpcClient.patient.recent.query({ limit, offset }));
    },

    byId(id: string): Promise<PatientDetail> {
        return wrap(() => trpcClient.patient.byId.query({ id }));
    },

    /** Only `patientIds`' balances — the list asks once per page it has loaded. */
    async outstanding(patientIds: string[]): Promise<PatientBalance[]> {
        const report = await wrap<{ patients: OutstandingRow[] }>(() =>
            trpcClient.balance.outstanding.query({ patientIds }),
        );
        return report.patients.map((row) => ({ patientId: row.patientId, balance: row.balance }));
    },

    /**
     * Registering someone. The whole `custom` form goes with it, because
     * `validateIntake` is the one place the clinic's required questions are
     * enforced — an edit later is only ever validated against the keys it sends.
     */
    create(input: CreatePatientInput): Promise<Patient> {
        return wrap(() => trpcClient.patient.create.mutate(input));
    },

    update(input: UpdatePatientInput): Promise<Patient> {
        return wrap(() => trpcClient.patient.update.mutate(input));
    },

    /**
     * Correcting the record's number, which `patient.update` deliberately
     * cannot do: the server gates it by role and writes an audit row, so it is
     * its own procedure and its own call here.
     */
    updateRef(input: UpdatePatientRefInput): Promise<Patient> {
        return wrap(() => trpcClient.patient.updateRef.mutate(input));
    },

    /**
     * Every correction made to this record's number, newest first. Answers `[]`
     * rather than refusing for a record that is gone — the trail outlives it.
     */
    refHistory(id: string): Promise<RefEdit[]> {
        return wrap(() => trpcClient.patient.refHistory.query({ id }));
    },

    /**
     * A visit that happened on a day that has passed and was never typed in.
     * This one bills: what comes back is charged and the patient owes it, so
     * the record's outstanding strip moves and `balance.settle` is how it gets
     * paid — there is no second place money is taken.
     *
     * Never retried: the write is not idempotent, so a second call writes a
     * second visit, and this one has money on it.
     */
    addOldVisit(input: AddOldVisitInput): Promise<AddedOldVisit> {
        return wrap(() =>
            trpcClient.procedure.addOldVisit.mutate({ ...input, offsetMinutes: clinicOffsetNow() }),
        );
    },

    /**
     * The record and everything under it. Refused while any of their visits
     * has a payment. Resolves to `true` rather than nothing: `useMutation`
     * hands back `undefined` for a failure, and a call that returned nothing
     * on success would be indistinguishable from one.
     */
    async delete(id: string): Promise<true> {
        await wrap(() => trpcClient.patient.delete.mutate({ id }));
        return true;
    },

    /**
     * The app's one payment entry point. The money goes against the patient and
     * the server allocates it across their unsettled visits oldest-first, so
     * nothing here names a visit and nothing here does arithmetic on a balance
     * (§10). What comes back is the split, which the sheet reads out.
     *
     * Never retried: a silent retry after a Tailscale timeout takes the money
     * twice. `useMutation` in `./hooks` refuses an overlapping call rather
     * than queueing it, which is the other half of the same guarantee.
     */
    settle(input: SettleInput): Promise<SettleReport> {
        return wrap(() => trpcClient.balance.settle.mutate(input));
    },
};
