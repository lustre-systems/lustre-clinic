import { CLIENT_ROLES, type ClientRole, type Role, viewOf } from '@lustre/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import type { Credential } from '../api';
import { hydratingSubscribe } from './hydratingSubscribe';

const ROLE_KEY = 'lustre.role';

const FALLBACK_ROLE: ClientRole = 'secretary';

export interface RoleState {
    hydrated: boolean;
    role: ClientRole;
}

function isRole(value: string | null): value is ClientRole {
    return value !== null && (CLIENT_ROLES as readonly string[]).includes(value);
}

export function createRoleStore(key = ROLE_KEY, fallback: ClientRole = FALLBACK_ROLE) {
    let state: RoleState = { hydrated: false, role: fallback };
    const listeners = new Set<() => void>();

    function emit(next: RoleState): void {
        state = next;
        for (const listener of listeners) listener();
    }

    let chosen = false;

    async function hydrate(): Promise<void> {
        const stored = await AsyncStorage.getItem(key).catch(() => null);
        if (chosen) return;
        emit({ hydrated: true, role: isRole(stored) ? stored : fallback });
    }

    const subscribe = hydratingSubscribe(listeners, hydrate);

    return {
        subscribe,
        getSnapshot: (): RoleState => state,
        set(next: ClientRole): void {
            chosen = true;
            emit({ hydrated: true, role: next });
            void AsyncStorage.setItem(key, next).catch(() => undefined);
        },
    };
}

const ADMIN_VIEW_KEY = 'lustre.admin.view';

const store = createRoleStore();
const adminView = createRoleStore(ADMIN_VIEW_KEY, 'doctor');

export interface PhoneRole {
    hydrated: boolean;
    role: ClientRole;
    granted: Role | null;
}

export function resolveRole(
    legacy: RoleState,
    admin: RoleState,
    credential: Credential | null,
    credentialReady: boolean,
): PhoneRole {
    const role = credential
        ? credential.role === 'admin'
            ? admin.role
            : viewOf(credential.role)
        : legacy.role;
    return {
        hydrated: legacy.hydrated && admin.hydrated && credentialReady,
        role,
        granted: credential?.role ?? null,
    };
}

export function useAdminView(): RoleState {
    return useSyncExternalStore(adminView.subscribe, adminView.getSnapshot);
}

export function setAdminView(next: ClientRole): void {
    adminView.set(next);
}

export function useLegacyRole(): RoleState {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
