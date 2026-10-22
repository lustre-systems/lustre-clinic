/**
 * "Last done" on the day view, for every role: the history button in the
 * bottom corner opposite the book button, and the layer it opens — the sheet,
 * and the booking or visit a line is about.
 *
 * A line knows ids and nothing more, so it opens the two pages that are built
 * to start from ids (`VisitPage`, `ReschedulePage`) on a stack of its own over
 * the day, rather than the screen's routes, which carry whole appointments. A
 * line about a patient goes to their record the way every other one on the day
 * view does, through `onOpenRecord`.
 *
 * The button only plays its expand when the day is what is on screen: the tab
 * is up and nothing is pushed over it.
 */

import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PushView } from '../../../components/ui';
import { LastDoneButton, LastDoneSheet, type LastDoneTarget, lastDone } from '../../../lastDone';
import { isOpen, rendered, useRouteStack } from '../../../navigation';
import { usePaneVisible } from '../../../shell/paneVisible';
import { size, space } from '../../../theme';
import { ReschedulePage } from './ReschedulePage';
import { VisitPage } from './VisitPage';

type Opened = Exclude<LastDoneTarget, { kind: 'patient' }>;

export type DayLastDone = {
    /** The floating button, for the screen to place beside its book button, under its pages. */
    button: ReactNode;
    /** Rendered last on the screen, over everything else on it. */
    layer: ReactNode;
};

export function useDayLastDone({
    covered,
    onOpenRecord,
    onChanged,
}: {
    /** Something of the screen's own is pushed over the day. */
    covered: boolean;
    onOpenRecord?: (patientId: string) => void;
    /** A page opened from a line wrote something; the day is stale. */
    onChanged: () => void;
}): DayLastDone {
    const paneVisible = usePaneVisible();
    const [sheet, setSheet] = useState(false);
    const routes = useRouteStack<Opened>();

    function open(target: LastDoneTarget) {
        if (target.kind === 'patient') onOpenRecord?.(target.patientId);
        else routes.push(target);
    }

    const button = (
        <View style={styles.corner} pointerEvents="box-none">
            <LastDoneButton
                active={paneVisible && !covered && routes.stack.open.length === 0}
                onPress={() => {
                    lastDone.markSeen();
                    setSheet(true);
                }}
            />
        </View>
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

// The book button's corner, mirrored: the same inset and the same centre line,
// so the two read as a pair across the bottom of the day.
const BOOK_FAB = 52;
const BUTTON = 44;

const styles = StyleSheet.create({
    corner: {
        position: 'absolute',
        start: size.gutter,
        bottom: space[6] + (BOOK_FAB - BUTTON) / 2,
    },
});
