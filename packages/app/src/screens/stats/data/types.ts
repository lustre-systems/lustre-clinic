import type { RouterOutput } from '../../../api';

type Iso<T> = T extends Date
    ? string
    : T extends Array<infer U>
      ? Array<Iso<U>>
      : T extends object
        ? { [K in keyof T]: Iso<T[K]> }
        : T;

export type OutstandingReport = Iso<RouterOutput['balance']['outstanding']>;
export type PatientBalance = OutstandingReport['patients'][number];

export type StatsFigures = Iso<RouterOutput['stats']['overview']>;

export type TakingsReport = Iso<RouterOutput['balance']['takings']>;
export type MethodTaking = TakingsReport['byMethod'][number];
