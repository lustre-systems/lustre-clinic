type DateKey =
    | 'createdAt'
    | 'updatedAt'
    | 'startsAt'
    | 'paidAt'
    | 'dueAt'
    | 'sentAt'
    | 'checkedInAt'
    | 'inChairAt'
    | 'pricedAt'
    | 'completedAt'
    | 'editedAt'
    | 'issuedAt'
    | 'expiresAt'
    | 'redeemedAt'
    | 'revokedAt'
    | 'oldestUnpaidAt'
    | 'from'
    | 'to';

type AsDate<T> = null extends T ? Date | null : Date;

export type Dated<T> = T extends Date
    ? T
    : T extends (infer U)[]
      ? Dated<U>[]
      : T extends object
        ? { [K in keyof T]: K extends DateKey ? AsDate<T[K]> : Dated<T[K]> }
        : T;
