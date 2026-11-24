import { EmptyState, SkeletonRows } from '../../../components/ui';
import { color } from '../../../theme';
import { errorMessage } from '../../stats/format';
import { RetryIcon, SearchIcon } from '../components/icons';
import type { useOutstanding } from './data';

export type OwesEmptyProps = {
    outstanding: ReturnType<typeof useOutstanding>;
    searching: boolean;
};

export function OwesEmpty({ outstanding, searching }: OwesEmptyProps) {
    if (outstanding.error) {
        return (
            <EmptyState
                icon={<RetryIcon size={22} stroke={color.ink2} />}
                title="Could not reach the clinic"
                body={errorMessage(outstanding.error)}
                actionLabel="Try again"
                onAction={outstanding.refetch}
                weight="panel"
            />
        );
    }
    if (!outstanding.data) return <SkeletonRows count={5} ruled />;

    return searching ? (
        <EmptyState
            icon={<SearchIcon size={22} stroke={color.ink2} />}
            title="No patients found"
            body="Nobody who owes matches that name or number."
            weight="panel"
        />
    ) : (
        <EmptyState title="Nobody owes anything." weight="panel" />
    );
}
