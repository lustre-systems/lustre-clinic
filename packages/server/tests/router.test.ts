import { describe, expect, test } from 'bun:test';
import { appRouter } from '../src/trpc/router.ts';

/**
 * SPEC §13 lists the API surface. This asserts the router tree matches it, so
 * a module that is built but never merged into `appRouter` fails here rather
 * than when the app tries to call it.
 */

const EXPECTED = [
    'health.check',
    'health.clock',
    'settings.get',
    'settings.update',
    'settings.schedule',
    'settings.setDay',
    'settings.clearDay',
    'branch.list',
    'branch.create',
    'branch.update',
    'procedure.tree',
    'procedure.create',
    'procedure.createCategory',
    'procedure.update',
    'procedure.reorder',
    'patient.search',
    'patient.byId',
    'patient.byPhone',
    'patient.recent',
    'patient.create',
    'patient.update',
    'customQuestion.list',
    'customQuestion.create',
    'customQuestion.update',
    'customQuestion.reorder',
    'appointment.byDate',
    'appointment.byId',
    'appointment.missed',
    'appointment.create',
    'appointment.walkIn',
    'appointment.update',
    'appointment.markLabReady',
    'appointment.cancel',
    'visit.checkIn',
    'visit.byId',
    'visit.setProcedures',
    'visit.setPrice',
    'visit.checkOut',
    'visit.recordPayment',
    'balance.outstanding',
    'balance.byPatient',
    'balance.summary',
    'balance.takings',
    'reminder.pending',
    'reminder.markSent',
    'reminder.markSkipped',
    'reminder.dismissToday',
    'reminder.resumeToday',
    'stats.summary',
    'migration.progress',
    'device.me',
    'device.redeem',
    'device.grants',
    'device.issue',
    'device.revoke',
    'device.setRequireProvisioning',
];

describe('appRouter', () => {
    const paths = Object.keys(appRouter._def.procedures);

    test.each(EXPECTED)('exposes %s', (path) => {
        expect(paths).toContain(path);
    });
});
