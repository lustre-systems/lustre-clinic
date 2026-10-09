/**
 * Who may call what, and what they are shown — the server's procedure kinds
 * (`server/src/trpc/init.ts`) and its `viewer` arguments, applied here in one
 * place rather than in every handler. The lists below are the server's routers
 * read off by kind, and have to be changed with them.
 */
import { ERROR_CODE, managesClinic, seesPayments, viewOf } from '@lustre/shared';
import { authorizeDemo, type DemoCaller } from './handlers/device';
import { DemoError } from './rules';

/** `publicProcedure`: reachable by a phone the server does not let in. */
const PUBLIC = new Set(['health.check', 'health.clock', 'release.latestApk', 'device.me', 'device.redeem']);

/** `paymentProcedure`: refused to a doctor. */
const PAYMENT = new Set([
    'balance.outstanding',
    'balance.byPatient',
    'balance.settle',
    'balance.summary',
    'balance.takings',
    'stats.summary',
    'visit.recordPayment',
    'visit.setPaid',
    'visit.setPaidMethod',
    'visit.deletePayment',
]);

/** `setupProcedure`: setting the clinic up, which only an admin may. */
const SETUP = new Set([
    'branch.create',
    'branch.update',
    'settings.setDay',
    'settings.clearDay',
    'procedure.create',
    'procedure.createCategory',
    'procedure.update',
    'procedure.reorder',
    'customQuestion.create',
    'customQuestion.update',
    'customQuestion.reorder',
    'backup.linkDrive',
]);

/** The fields of `settings.update` that set the clinic up (`settingsService.update`). */
const CLINIC_FIELDS = [
    'clinicName',
    'clinicPhone',
    'patientRefNext',
    'requireAge',
    'requireGender',
    'clinicType',
];

/** `adminProcedure`. */
const ADMIN = new Set(['device.grants', 'device.issue', 'device.revoke', 'device.setRequireProvisioning']);

/** Procedures that answer with a whole visit, whose payment fields a doctor is not shown. */
const VISIT_ANSWERS = new Set([
    'visit.byId',
    'visit.byAppointment',
    'visit.setProcedures',
    'visit.setPrice',
    'visit.checkOut',
    'visit.reopen',
]);

function forbidden(what: string): DemoError {
    return new DemoError(ERROR_CODE.ROLE_FORBIDDEN, `this role may not ${what}`, 403);
}

/** The caller behind `token`, or the refusal the server would send for `path` with `input`. */
export function admit(path: string, token: string | null, input?: unknown): DemoCaller {
    if (PUBLIC.has(path)) return { token, deviceId: null, role: null };
    const caller = authorizeDemo(token);
    if (PAYMENT.has(path) && !seesPayments(caller.role)) throw forbidden('see payments');
    if (path === 'visit.reopen' && !seesPayments(caller.role)) throw forbidden('reopen a finished visit');
    if (SETUP.has(path) && !managesClinic(caller.role)) throw forbidden('change how the clinic is set up');
    const fields = input && typeof input === 'object' ? Object.keys(input) : [];
    if (
        path === 'settings.update' &&
        !managesClinic(caller.role) &&
        fields.some((f) => CLINIC_FIELDS.includes(f))
    ) {
        throw forbidden('change how the clinic is set up');
    }
    if (ADMIN.has(path) && caller.role !== 'admin') throw forbidden('manage roles');
    return caller;
}

/** A provisioned phone edits a ref as its credential's view, whatever it claims (`patientService.updateRef`). */
export function inputFor(path: string, input: unknown, caller: DemoCaller): unknown {
    if (path !== 'patient.updateRef' || !caller.role || !input || typeof input !== 'object') return input;
    return { ...input, editedBy: viewOf(caller.role) };
}

function withheld<T extends object>(row: T, fields: readonly string[]): T {
    return { ...row, ...Object.fromEntries(fields.map((field) => [field, null])) };
}

/** A finished visit's amounts, which a doctor is not shown either (`visitService.byId`). */
function withheldVisit(visit: { completedAt: unknown; procedures: object[] }): object {
    const unpaid = withheld(visit, ['payments', 'paidTotal', 'balance']);
    if (visit.completedAt === null) return unpaid;
    return {
        ...withheld(unpaid, ['chargedTotal', 'computedTotal']),
        procedures: visit.procedures.map((line) => withheld(line, ['unitPrice', 'lineTotal'])),
    };
}

interface HistoryEntry {
    completedAt: unknown;
    isImported: boolean;
    isOpeningBalance: boolean;
}

/** What `path` answered, less what the caller's role may not see. */
export function shownTo(path: string, output: unknown, caller: DemoCaller): unknown {
    if (seesPayments(caller.role) || !output || typeof output !== 'object') return output;
    if (path === 'migration.progress') return withheld(output, ['openingBalanceTotal']);
    if (VISIT_ANSWERS.has(path)) return withheldVisit(output as Parameters<typeof withheldVisit>[0]);
    if (path === 'patient.byId') {
        const detail = output as { history: HistoryEntry[] };
        return {
            ...detail,
            history: detail.history.map((entry) => {
                const past = entry.completedAt !== null || entry.isImported || entry.isOpeningBalance;
                const fields = past
                    ? ['paidTotal', 'balance', 'chargedTotal', 'computedTotal']
                    : ['paidTotal', 'balance'];
                return withheld(entry, fields);
            }),
        };
    }
    return output;
}
