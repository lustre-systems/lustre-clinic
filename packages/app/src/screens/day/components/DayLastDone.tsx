/**
 * "Last done" on the day view, for every role: the Done segment beside Today
 * (and Reminders, on the desk's phone), the list it shows, and the layer a line
 * opens onto.
 *
 * The segment carries today's count and a dot while something has been done
 * since the list was last looked at. Showing the list — and leaving it, since
 * whatever landed while it was up was seen — clears the dot.
 *
 * A line knows ids and nothing more, so it opens the two pages that are built
 * to start from ids (`VisitPage`, `ReschedulePage`) on a stack of its own over
 * the day, rather than the screen's routes, which carry whole appointments. A
 * line about a patient goes to their record the way every other one on the day
 * view does, through `onOpenRecord`.
 */
import { type ReactNode, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { serverToday } from '../../../api';
import { GLYPH, icon } from '../../../components/domain';
import { PushView, type Segment } from '../../../components/ui';
import { useT } from '../../../i18n';
import { hasUnseen, LastDoneList, type LastDoneTarget, lastDone, todayCount } from '../../../lastDone';
import { isOpen, rendered, useRouteStack } from '../../../navigation';
import { color, radius } from '../../../theme';
import { ReschedulePage } from './ReschedulePage';
import { VisitPage } from './VisitPage';

const HistoryIcon = icon(GLYPH.lastDone);

type Opened = Exclude<LastDoneTarget, { kind: 'patient' }>;

export type DayLastDone = {
    segment: Segment<'done'>;
    /** The Done tab's body. */
    list: ReactNode;
    /** Rendered last on the screen, over everything else on it. */
    layer: ReactNode;
    /** The Done tab was shown or left: what is on it has been seen. */
    seen: () => void;
};

export function useDayLastDone({
    onOpenRecord,
    onChanged,
}: {
    onOpenRecord?: (patientId: string) => void;
    /** A page opened from a line wrote something; the day is stale. */
    onChanged: () => void;
}): DayLastDone {
    const t = useT();
    const state = useSyncExternalStore(lastDone.subscribe, lastDone.getSnapshot);
    const routes = useRouteStack<Opened>();

    const count = todayCount(state, serverToday());
    const unseen = hasUnseen(state);

    function open(target: LastDoneTarget) {
        if (target.kind === 'patient') onOpenRecord?.(target.patientId);
        else routes.push(target);
    }

    const segment: Segment<'done'> = {
        value: 'done',
        label: count > 0 ? `${t('Done')} · ${count}` : t('Done'),
        icon: (selected) => (
            <View>
                <HistoryIcon size={15} stroke={selected ? color.ink : color.ink2} />
                {unseen && !selected ? <View style={styles.dot} testID="last-done-new" /> : null}
            </View>
        ),
    };

    const layer = rendered(routes.stack).map(({ id, route }, index) => (
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
    ));

    return {
        segment,
        list: <LastDoneList onOpen={open} />,
        layer,
        seen: () => lastDone.markSeen(),
    };
}

const styles = StyleSheet.create({
    dot: {
        position: 'absolute',
        top: -2,
        end: -3,
        width: 7,
        height: 7,
        borderRadius: radius.full,
        backgroundColor: color.accent,
        borderWidth: 1,
        borderColor: color.surface2,
    },
});
