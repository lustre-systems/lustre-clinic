/**
 * The whole debtor list, for the "Owes money" filter. The list's own rows read
 * balances a page at a time (`patientsApi.outstanding`); this is the same
 * procedure asked for everyone, which is what the filter shows.
 */
import { useQuery } from '@tanstack/react-query';
import { errorCodeOf, useTRPC } from '../../../api';
import type { OutstandingReport } from '../../stats/data';

export type { PatientBalance } from '../../stats/data';

export function useOutstanding(enabled: boolean) {
    const trpc = useTRPC();
    const query = useQuery({ ...trpc.balance.outstanding.queryOptions(), enabled });
    return {
        data: query.data as OutstandingReport | undefined,
        isLoading: query.isPending,
        error: query.error ? errorCodeOf(query.error) : null,
        refetch: () => {
            void query.refetch();
        },
    };
}
