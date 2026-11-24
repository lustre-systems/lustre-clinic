import type { ClientRole } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: writes the role onto the crash reporter's scope, which lives outside React
import { useEffect } from 'react';
import { tagRole } from './reporting';

export function useCrashReportRole(role: ClientRole): void {
    useEffect(() => {
        tagRole(role);
    }, [role]);
}
