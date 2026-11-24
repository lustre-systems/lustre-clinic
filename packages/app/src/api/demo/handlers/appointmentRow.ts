import { type AppointmentRow, getDb } from '../db';
import { buildRef, uuidv7 } from '../rules';

export function insertAppointment(
    values: Omit<AppointmentRow, 'id' | 'ref' | 'labStatus' | 'createdAt' | 'updatedAt'> &
        Partial<Pick<AppointmentRow, 'labStatus'>>,
    offsetMinutes: number,
): AppointmentRow {
    const now = new Date();
    const row: AppointmentRow = {
        labStatus: null,
        ...values,
        id: uuidv7(),
        ref: buildRef(values.startsAt, offsetMinutes),
        createdAt: now,
        updatedAt: now,
    };

    getDb().appointments.push(row);
    return row;
}
