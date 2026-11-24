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
    seq: number;
    backLabel?: string;
};

type PatientsClusterProps = {
    open?: OpenRecordRequest;
    goHome?: number;
    onBook: (patient: PatientTarget) => void;
};

function PatientsClusterView({ open, goHome = 0, onBook }: PatientsClusterProps) {
    const [seen, setSeen] = useState(0);
    const [seenHome, setSeenHome] = useState(goHome);
    const [saving, setSaving] = useState(false);
    const [read, setRead] = useState(0);
    const [notice, setNotice] = useState<{ seq: number; message: string } | undefined>(undefined);
    const invalidate = useInvalidatePatients();
    useFollowServerChanges();

    const routes = useRouteStack<Route>({ locked: saving });

    const live = useRef(routes.stack);
    live.current = routes.stack;

    const reread = () => {
        invalidate();
        setRead((n) => n + 1);
    };

    if (open && open.seq !== seen) {
        setSeen(open.seq);
        routes.resetTo({ name: 'record', patientId: open.patientId, backLabel: open.backLabel });
    }

    if (goHome !== seenHome) {
        setSeenHome(goHome);
        if (!saving) routes.popToRoot();
    }

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

                    {route.name === 'visit' ? (
                        <VisitPage
                            key={`visit:${route.visitId}`}
                            appointmentId={route.appointmentId}
                            visitId={route.visitId}
                            onClose={routes.pop}
                            onChanged={reread}
                        />
                    ) : null}

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

export const PatientsCluster = memo(PatientsClusterView);
