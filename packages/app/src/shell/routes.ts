// The two things the shell has to do that no cluster can do for itself, kept
// here as data so they can be tested — `bun test` has no renderer, so anything
// that only exists inside a component is verified on a device.
//
// **Pushing a route another cluster owns.** The record screen's Book, Walk-in
// and Record payment all land in the day or money cluster, and a cluster holds
// its own stack, so the ask has to go up to the shell and back down. It travels
// as a *request*, not a route: the destination decides which of its screens
// that means. `seq` is what makes one ask distinguishable from the next, so the
// same destination can be asked for twice — the pattern `PatientsCluster`
// already reads its record request with.
//
// **Going home.** Tapping the tab you are already on pops that cluster back to
// its root. The shell cannot pop a cluster from outside — it does not own the
// routes inside one — so it bumps a counter per tab and each cluster resets
// itself when its number changes, deciding for itself what home means.
//
// **Disconnected.** Which of the shell's two routes the connection state means.
import type { ConnectionStatus } from '../api';
import type { TabKey } from '../components/domain';

/** A cross-cluster request: what the destination needs, plus which ask it is. */
export type Ask<T> = T & { seq: number };

/** The next ask after `current`, whatever `current` was for. */
export function ask<T>(current: Ask<unknown> | undefined, next: T): Ask<T> {
    return { ...next, seq: (current?.seq ?? 0) + 1 };
}

/** Whether a request is one the cluster has not acted on yet. */
export function isUnseen(request: Ask<unknown> | undefined, seen: number): boolean {
    return request !== undefined && request.seq !== seen;
}

/** Every tab there is, in tab-bar order. */
export const ALL_TABS: readonly TabKey[] = ['day', 'patients', 'stats', 'settings'];

/**
 * The shell's two routes. Disconnected is one of them and not a state each
 * screen draws for itself: there is a single answer to "the clinic cannot be
 * reached" and a single place it is given, which is also the only way the app
 * can be sure nothing live-looking is left on screen behind it.
 */
export type ShellRoute = 'app' | 'offline';

/**
 * Which route a connection status means, given the one that is up.
 *
 * Only the two definite answers move it, and that asymmetry is the whole rule:
 * `probing` is on the way to both of them — every retry and every re-probe
 * passes through it — so reading it as either would drop the disconnected
 * screen for a few hundred milliseconds and flash the stale app underneath, or
 * put it up over an app that is about to be told it is fine. `unknown` is the
 * same case at launch, before anything has been asked.
 */
export function nextRoute(current: ShellRoute, status: ConnectionStatus): ShellRoute {
    if (status === 'offline') return 'offline';
    if (status === 'online') return 'app';
    return current;
}

/** One counter per tab. A cluster sees its own number change and resets. */
export type HomeSignals = Record<TabKey, number>;

export const NO_HOME: HomeSignals = { day: 0, patients: 0, stats: 0, settings: 0 };

export function bumpHome(current: HomeSignals, tab: TabKey): HomeSignals {
    return { ...current, [tab]: current[tab] + 1 };
}

/**
 * Who a cross-cluster push is about. Every destination needs the patient named
 * rather than just identified — the booking page prints the name and number
 * back at the desk, and the money cluster's patient route carries the name
 * because `visit.balances` does not return it.
 */
export type PatientTarget = {
    id: string;
    name: string;
    phone: string;
};

/** Book for a day yet to be chosen, or seat them now. */
export type BookingTiming = 'now' | 'later';
