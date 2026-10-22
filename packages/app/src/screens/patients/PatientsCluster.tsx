// The Patients cluster's own root — list ⇄ record ⇄ editor. There is still no
// navigator (SPEC §18 F3), but the routes above the list are a real stack now
// (`src/navigation`), so back is `pop` and the chevron calls the same function.
// Every screen is already written against `onOpen(patientId)`, `onBack()` and
// `onSaved(patientId)`. The shell (`src/shell`) mounts this as the Patients tab.
//
// The list is the root and stays mounted underneath, which is what keeps its
// scroll and its search text while a record is being read. Everything above it
// is a pane on `ui/PushView`, drawn from the stack.
//
// A record can also be asked for from outside — the doctor's day view opens one
// off an appointment — and a patient's record is the Patients tab's screen, so
// the shell switches tabs and passes the request down here rather than each
// cluster drawing its own copy inside its own tab. `open` is the request, not the
// route: it carries a `seq` so asking for the same patient twice re-opens the
// record after it has been backed out of, and `backLabel` says where back goes
// in the caller's words. It lands through `resetTo`, because a jump from another
// tab has nothing on the way out worth watching leave.
//
// The traffic runs the other way too: the record's Book and Walk-in both land
// in a cluster this one cannot reach, so they are handed back up to the shell
// with the patient and nothing else. `goHome` comes down the same wire — the
// shell cannot pop a route it does not own, so it says only that the tab was
// tapped, and here that is `popToRoot`.
//
// The editor is reachable from both screens and returns to whichever asked for
// it. That used to need a `from` field on the route; the stack already knows
// what is underneath, so it does not. Saving does not simply go back —
// registering someone lands on the record that now exists, and correcting one
// returns to the record it was opened from with `read` bumped, so the screen
// remounts and re-reads rather than showing what it held before the write.
import { memo, useRef, useState } from 'react';
import { PushView } from '../../components/ui';
import { beneath, isOpen, isTop, rendered, useRouteStack } from '../../navigation';
import type { PatientTarget } from '../../shell/routes';
import { ReschedulePage, VisitPage } from '../day';
import { useFollowServerChanges, useInvalidatePatients } from './data/hooks';
import { OldVisitScreen } from './OldVisitScreen';
import { PatientEditScreen } from './PatientEditScreen';
import { PatientListScreen } from './PatientListScreen';
import { PatientRecordScreen } from './PatientRecordScreen';
import type { PatientPrefill } from './patientForm';

type Route =
    | { name: 'record'; patientId: string; backLabel?: string }
    | { name: 'edit'; patientId?: string; prefill?: PatientPrefill }
    | { name: 'visit'; appointmentId: string; visitId: string }
    | { name: 'reschedule'; appointmentId: string }
    | { name: 'oldVisit'; patientId: string };

export type OpenRecordRequest = {
    patientId: string;
    /** Bumped per request so the same patient can be re-opened. */
    seq: number;
    backLabel?: string;
};

type PatientsClusterProps = {
    open?: OpenRecordRequest;
    /**
     * Bumped by the shell when the Patients tab is tapped while it is already
     * up. Home here is the list with its search field, which is the one thing
     * the shell could not decide for itself.
     */
    goHome?: number;
    /**
     * The record's two openers, which both land in the day cluster. The shell
     * owns those routes (`shell/routes.ts`); this passes the patient up and
     * nothing more. Absent leaves the record screen's own fallback in place,
     * which names where the flow lives rather than failing silently.
     *
     * Record payment used to be a third. It is not a cross-cluster request any
     * more — the sheet opens on the record itself, because the server allocates
     * a patient-level payment and there is no longer a visit to go and pick.
     */
    onBook: (patient: PatientTarget) => void;
};

function PatientsClusterView({ open, goHome = 0, onBook }: PatientsClusterProps) {
    const [seen, setSeen] = useState(0);
    const [seenHome, setSeenHome] = useState(goHome);
    /** The editor, mid-write. A tab tap must not take the screen out from under it. */
    const [saving, setSaving] = useState(false);
    /**
     * Bumped by a save, so the record behind the editor remounts onto fresh data.
     *
     * The remount alone is no longer enough to make it fresh: the cluster reads
     * through a real query cache now, and a new mount re-attaches to whatever is
     * cached rather than going back to the server. So a bump drops the cache
     * with it — `reread` is the two together, and nothing may bump `read` on its
     * own.
     */
    const [read, setRead] = useState(0);
    /** What an old visit said as it closed, for the record it closed back onto. */
    const [notice, setNotice] = useState<{ seq: number; message: string } | undefined>(undefined);
    const invalidate = useInvalidatePatients();
    useFollowServerChanges();

    // Back is `pop`, wired once by the hook. A save in flight swallows the press
    // rather than queueing it, the same way the editor drops Cancel instead of
    // greying it out.
    const routes = useRouteStack<Route>({ locked: saving });

    /**
     * The stack as it stands, for the one caller that cannot use the copy from
     * the render it was written in: a save landing after the editor that sent
     * it has been taken off the stack. Everything else here reads `routes.stack`
     * either during render or in the handler that caused the change, where the
     * two are the same thing.
     */
    const live = useRef(routes.stack);
    live.current = routes.stack;

    const reread = () => {
        invalidate();
        setRead((n) => n + 1);
    };

    // Derived during render rather than in an effect: the record is on screen in
    // the same commit as the tab switch, so the pane does not paint the list for
    // a frame first.
    if (open && open.seq !== seen) {
        setSeen(open.seq);
        routes.resetTo({ name: 'record', patientId: open.patientId, backLabel: open.backLabel });
    }

    // The tap is spent either way: a save in flight swallows it rather than
    // queueing it.
    if (goHome !== seenHome) {
        setSeenHome(goHome);
        if (!saving) routes.popToRoot();
    }

    /**
     * Where a save lands. Correcting someone whose record is already underneath
     * returns to it — the stack is what knows that, where the route used to
     * carry a `from` saying the same thing in a second place. Registering
     * someone new has no record to return to, so the editor becomes one.
     *
     * `id` is the entry the editor was drawn from, and the landing only happens
     * while that is still on top. A request from another tab arrives during
     * render and resets the stack whether or not a write is in flight — `saving`
     * holds the back press, not the shell — and it takes the editor's pane with
     * it. The write carries on regardless and comes back to a stack that is not
     * the one it left: without the check it pops the record the shell has just
     * asked for, or, registering someone, replaces that record with the new one.
     *
     * The cache is dropped either way. The write happened; what is on screen
     * does not change that.
     */
    function afterSave(id: number, patientId: string) {
        reread();
        const stack = live.current;
        if (!isTop(stack, id)) return;
        const under = beneath(stack);
        if (under?.name === 'record' && under.patientId === patientId) routes.pop();
        else routes.replaceTop({ name: 'record', patientId });
    }

    return (
        <>
            <PatientListScreen
                goHome={goHome}
                onOpen={(patientId) => routes.push({ name: 'record', patientId })}
                onNewPatient={(prefill) => routes.push({ name: 'edit', prefill })}
            />

            {/* Bottom to top, the order they were opened in. A popped route is
                still in here until its pane reports the slide finished, which
                is what `onClosed` is for — dropping it any earlier empties the
                pane halfway out. The index is stable across a pop: a route
                leaving `open` takes the first place in `leaving`, which is the
                same position in `rendered`. */}
            {rendered(routes.stack).map(({ id, route }, index) => (
                <PushView
                    key={id}
                    visible={isOpen(routes.stack, index)}
                    onClosed={routes.settled}
                    testID={`patients-${route.name}`}
                >
                    {route.name === 'record' ? (
                        <PatientRecordScreen
                            key={`record:${route.patientId}:${read}`}
                            patientId={route.patientId}
                            backLabel={route.backLabel}
                            onBack={routes.pop}
                            onEdit={() => routes.push({ name: 'edit', patientId: route.patientId })}
                            onBook={onBook}
                            onOldVisit={() => routes.push({ name: 'oldVisit', patientId: route.patientId })}
                            notice={notice}
                            onOpenVisit={(entry) => {
                                if (entry.status === 'booked') {
                                    routes.push({ name: 'reschedule', appointmentId: entry.appointmentId });
                                    return;
                                }
                                if (!entry.visitId) return;
                                routes.push({
                                    name: 'visit',
                                    appointmentId: entry.appointmentId,
                                    visitId: entry.visitId,
                                });
                            }}
                        />
                    ) : null}

                    {route.name === 'edit' ? (
                        <PatientEditScreen
                            key={`edit:${route.patientId ?? 'new'}`}
                            patientId={route.patientId}
                            prefill={route.prefill}
                            onCancel={routes.pop}
                            onSavingChange={setSaving}
                            onSaved={(saved) => afterSave(id, saved)}
                        />
                    ) : null}

                    {/* `VisitPage` is the day cluster's whole visit stack behind
                        two ids — see `screens/day/index.ts`. It holds its own
                        routes and answers back for itself down to its first
                        screen, which is why closing it is a callback rather than
                        this pane popping underneath it. */}
                    {route.name === 'visit' ? (
                        <VisitPage
                            key={`visit:${route.visitId}`}
                            appointmentId={route.appointmentId}
                            visitId={route.visitId}
                            onClose={routes.pop}
                            // The record's totals move with the visit, so it is
                            // re-read rather than left showing what it held. The
                            // write happened in the day cluster, over the raw
                            // tRPC client, so nothing has touched this cluster's
                            // cache — `reread` is what makes the remount real.
                            onChanged={reread}
                        />
                    ) : null}

                    {/* Its write goes through this cluster's own mutation hook,
                        which drops the cache on success — so the record
                        underneath re-reads the charge on its own, without the
                        remount a day-cluster write needs. */}
                    {route.name === 'oldVisit' ? (
                        <OldVisitScreen
                            key={`oldVisit:${route.patientId}`}
                            patientId={route.patientId}
                            onBack={routes.pop}
                            onSavingChange={setSaving}
                            onRecorded={(message) => {
                                setNotice((last) => ({ seq: (last?.seq ?? 0) + 1, message }));
                                if (isTop(live.current, id)) routes.pop();
                            }}
                        />
                    ) : null}

                    {route.name === 'reschedule' ? (
                        <ReschedulePage
                            key={`reschedule:${route.appointmentId}`}
                            appointmentId={route.appointmentId}
                            onClose={routes.pop}
                            onChanged={reread}
                        />
                    ) : null}
                </PushView>
            ))}
        </>
    );
}

/**
 * The shell keeps this tab mounted behind the others, so without this it would
 * re-render — list, record or editor and everything under it — every time a tab
 * was tapped. The shell holds `open`, `goHome`, `onBook` and `onWalkIn` stable
 * across a switch, so the comparison is what stops that.
 */
export const PatientsCluster = memo(PatientsClusterView);
