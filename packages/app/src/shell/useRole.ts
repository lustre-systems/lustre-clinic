import { useCredential, useDeviceBackend } from '../api';
import { type PhoneRole, resolveRole, useAdminView, useLegacyRole } from './roleStore';

export function useRole(): PhoneRole {
    const legacy = useLegacyRole();
    const admin = useAdminView();
    const { hydrated, credential } = useCredential();
    const resolved = resolveRole(legacy, admin, credential, hydrated);
    const local = useDeviceBackend().backend === 'local';
    return local ? { ...resolved, role: 'secretary' } : resolved;
}
