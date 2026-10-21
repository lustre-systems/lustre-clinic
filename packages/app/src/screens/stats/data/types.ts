/**
 * Every shape this cluster reads, inferred from `AppRouter` (CLAUDE.MD — request
 * and response types are never hand-written).
 *
 * `Iso<T>` is the one bridge: there is no transformer on either side, so a
 * `Date` the server returns is an ISO string by the time it lands while the
 * inferred type still says `Date`. Rewriting the date fields
 * here is what stops `.getTime()` compiling and throwing at the call site. It
 * goes when a transformer lands in `trpc/init.ts`.
 */
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
