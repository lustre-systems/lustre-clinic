import { type ReactNode, useState } from 'react';
import { PushView } from '../../../components/ui';
import { LastDoneButton, LastDoneSheet, type LastDoneTarget, lastDone } from '../../../lastDone';
import { isOpen, rendered, useRouteStack } from '../../../navigation';
import { usePaneVisible } from '../../../shell/paneVisible';
import { ReschedulePage } from './ReschedulePage';
import { VisitPage } from './VisitPage';

type Opened = Exclude<LastDoneTarget, { kind: 'patient' }>;

export type DayLastDone = {
    button: ReactNode;
    layer: ReactNode;
};

export function useDayLastDone({
    covered,
    goHome,
    onOpenRecord,
    onChanged,
}: {
    covered: boolean;
    goHome: number;
    onOpenRecord?: (patientId: string) => void;
    onChanged: () => void;
}): DayLastDone {
    const paneVisible = usePaneVisible();
    const [sheet, setSheet] = useState(false);
    const routes = useRouteStack<Opened>();
    const [seenHome, setSeenHome] = useState(goHome);

    if (goHome !== seenHome) {
        setSeenHome(goHome);
        setSheet(false);
        routes.popToRoot();
    }

    function open(target: LastDoneTarget) {
        if (target.kind === 'patient') onOpenRecord?.(target.patientId);
        else routes.push(target);
    }

    const button = (
        <LastDoneButton
            active={paneVisible && !covered && routes.stack.open.length === 0}
            onPress={() => {
                lastDone.markSeen();
                setSheet(true);
            }}
        />
    );

    const layer = (
        <>
            <LastDoneSheet visible={sheet} onClose={() => setSheet(false)} onOpen={open} />
            {rendered(routes.stack).map(({ id, route }, index) => (
                <PushView
                    key={id}
                    visible={isOpen(routes.stack, index)}
                    onClosed={routes.settled}
                    testID={`last-done-${route.kind}`}
                >
                    {route.kind === 'visit' ? (
                        <VisitPage
                            appointmentId={route.appointmentId}
                            visitId={route.visitId}
                            onClose={routes.pop}
                            onChanged={onChanged}
                        />
                    ) : (
                        <ReschedulePage
                            appointmentId={route.appointmentId}
                            onClose={routes.pop}
                            onChanged={onChanged}
                        />
                    )}
                </PushView>
            ))}
        </>
    );

    return { button, layer };
}
