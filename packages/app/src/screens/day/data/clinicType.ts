import { api } from './day';
import { useLocalQuery } from './hooks';

export function useGeneralClinic(): boolean {
    return useLocalQuery('settings', api.settings).data?.clinicType === 'general';
}
