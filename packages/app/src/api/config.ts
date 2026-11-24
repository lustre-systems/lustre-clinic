import { TRPC_ENDPOINT, WS_PATH } from '@lustre/shared';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { type BuildVariant, bootAddresses, usableAddresses, variantOf } from './variant';

export interface ServerAddresses {
    lan: string | null;
    tailscale: string | null;
}

interface BuildExtra {
    server?: Partial<ServerAddresses>;
    devServer?: unknown;
    demo?: unknown;
}

function normalize(address: unknown): string | null {
    if (typeof address !== 'string') return null;
    const trimmed = address.trim().replace(/\/+$/, '');
    return trimmed ? trimmed : null;
}

const extra = (Constants.expoConfig?.extra ?? {}) as BuildExtra;

export const BUILD_VARIANT: BuildVariant = variantOf({
    dev: __DEV__,
    shippedDemo: extra.demo === true,
    applicationId: Application.applicationId,
});

let addresses: ServerAddresses = usableAddresses(
    BUILD_VARIANT,
    bootAddresses(
        BUILD_VARIANT,
        { lan: normalize(extra.server?.lan), tailscale: normalize(extra.server?.tailscale) },
        normalize(extra.devServer),
    ),
);

export function serverAddresses(): ServerAddresses {
    return addresses;
}

export function setServerAddresses(next: Partial<ServerAddresses>): void {
    addresses = usableAddresses(BUILD_VARIANT, {
        lan: normalize(next.lan ?? addresses.lan),
        tailscale: normalize(next.tailscale ?? addresses.tailscale),
    });
}

export const timing = {
    lanProbeMs: 500,
    tailscaleProbeMs: 3_000,
    requestMs: 5_000,
    reconnectMinMs: 2_000,
    reconnectMaxMs: 30_000,
    staleAfterMs: 120_000,
} as const;

export function trpcUrl(base: string): string {
    return `${base}${TRPC_ENDPOINT}`;
}

export function wsUrl(base: string): string {
    return `${base.replace(/^http/, 'ws')}${WS_PATH}`;
}
