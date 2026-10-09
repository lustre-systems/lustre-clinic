/**
 * Every procedure on `AppRouter`, by path.
 *
 * The whole router is here rather than the subset the screens happen to call
 * today: a demo that answers 40 of 54 procedures is a demo that works until
 * someone opens the one screen nobody thought of, on stage. A procedure added
 * to the server and missed here fails the exhaustiveness check below at compile
 * time rather than at the tap.
 */
import type { RouterInput } from '../../types';
import { appointmentHandlers } from './appointment';
import { backupHandlers } from './backup';
import { balanceHandlers } from './balance';
import { branchHandlers } from './branch';
import { customQuestionHandlers } from './customQuestion';
import { type DemoCaller, deviceHandlers } from './device';
import { healthHandlers } from './health';
import { migrationHandlers } from './migration';
import { patientHandlers } from './patient';
import { procedureHandlers } from './procedure';
import { releaseHandlers } from './release';
import { reminderHandlers } from './reminder';
import { settingsHandlers } from './settings';
import { statsHandlers } from './stats';
import { visitHandlers } from './visit';

/**
 * `never` in the parameter is what lets handlers with different input types
 * share one table: every function type is assignable to it, and the single cast
 * that pays for it lives in `resolve` below.
 */
type Handler = (input: never, caller: DemoCaller) => unknown;

/** Every `module.procedure` string the router exposes, off the inferred inputs. */
type Path = {
    [M in keyof RouterInput]: `${M & string}.${keyof RouterInput[M] & string}`;
}[keyof RouterInput];

const handlers = {
    'health.check': healthHandlers.check,
    'health.clock': healthHandlers.clock,

    'release.latestApk': releaseHandlers.latestApk,

    'settings.get': settingsHandlers.get,
    'settings.update': settingsHandlers.update,
    'settings.schedule': settingsHandlers.schedule,
    'settings.setDay': settingsHandlers.setDay,
    'settings.clearDay': settingsHandlers.clearDay,

    'branch.list': branchHandlers.list,
    'branch.create': branchHandlers.create,
    'branch.update': branchHandlers.update,

    'procedure.tree': procedureHandlers.tree,
    'procedure.list': procedureHandlers.list,
    'procedure.create': procedureHandlers.create,
    'procedure.createCategory': procedureHandlers.createCategory,
    'procedure.update': procedureHandlers.update,
    'procedure.reorder': procedureHandlers.reorder,
    'procedure.addOldVisit': procedureHandlers.addOldVisit,

    'patient.search': patientHandlers.search,
    'patient.recent': patientHandlers.recent,
    'patient.byId': patientHandlers.byId,
    'patient.byPhone': patientHandlers.byPhone,
    'patient.updateRef': patientHandlers.updateRef,
    'patient.refHistory': patientHandlers.refHistory,
    'patient.create': patientHandlers.create,
    'patient.update': patientHandlers.update,
    'patient.delete': patientHandlers.delete,

    'customQuestion.list': customQuestionHandlers.list,
    'customQuestion.create': customQuestionHandlers.create,
    'customQuestion.update': customQuestionHandlers.update,
    'customQuestion.reorder': customQuestionHandlers.reorder,

    'appointment.byDate': appointmentHandlers.byDate,
    'appointment.byId': appointmentHandlers.byId,
    'appointment.missed': appointmentHandlers.missed,
    'appointment.create': appointmentHandlers.create,
    'appointment.walkIn': appointmentHandlers.walkIn,
    'appointment.update': appointmentHandlers.update,
    'appointment.markLabReady': appointmentHandlers.markLabReady,
    'appointment.cancel': appointmentHandlers.cancel,
    'appointment.awaitPayment': appointmentHandlers.awaitPayment,

    'visit.byId': visitHandlers.byId,
    'visit.byAppointment': visitHandlers.byAppointment,
    'visit.checkIn': visitHandlers.checkIn,
    'visit.setProcedures': visitHandlers.setProcedures,
    'visit.setPrice': visitHandlers.setPrice,
    'visit.checkOut': visitHandlers.checkOut,
    'visit.recordPayment': visitHandlers.recordPayment,
    'visit.reopen': visitHandlers.reopen,
    'visit.setPaid': visitHandlers.setPaid,
    'visit.delete': visitHandlers.delete,
    'visit.deletePayment': visitHandlers.deletePayment,

    'balance.outstanding': balanceHandlers.outstanding,
    'balance.byPatient': balanceHandlers.byPatient,
    'balance.settle': balanceHandlers.settle,
    'balance.summary': balanceHandlers.summary,
    'balance.takings': balanceHandlers.takings,

    'reminder.pending': reminderHandlers.pending,
    'reminder.markSent': reminderHandlers.markSent,
    'reminder.markSkipped': reminderHandlers.markSkipped,
    'reminder.dismissToday': reminderHandlers.dismissToday,
    'reminder.resumeToday': reminderHandlers.resumeToday,

    'stats.summary': statsHandlers.summary,

    'backup.status': backupHandlers.status,
    'backup.signInConfig': backupHandlers.signInConfig,
    'backup.linkDrive': backupHandlers.linkDrive,

    'migration.progress': migrationHandlers.progress,

    'device.me': deviceHandlers.me,
    'device.redeem': deviceHandlers.redeem,
    'device.devRole': deviceHandlers.devRole,
    'device.grants': deviceHandlers.grants,
    'device.issue': deviceHandlers.issue,
    'device.revoke': deviceHandlers.revoke,
    'device.setRequireProvisioning': settingsHandlers.setRequireProvisioning,
} as const satisfies Record<Path, Handler>;

// `in` would also answer for `toString` and `constructor`, and `resolve` would
// then call the prototype method instead of leaving `link.ts` to refuse.
export function hasHandler(path: string): path is Path {
    return Object.hasOwn(handlers, path);
}

/** The one cast: `resolve` is called with whatever the client sent for `path`. */
export function resolve(path: Path, input: unknown, caller: DemoCaller): unknown {
    return handlers[path](input as never, caller);
}
