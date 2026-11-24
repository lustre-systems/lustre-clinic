import type { ServerAddresses } from '../api';

export const DEV_LABEL = 'DEV';

export function serverLabel(connectedTo: string | null, addresses: ServerAddresses): string {
    const address = connectedTo ?? addresses.lan ?? addresses.tailscale;
    return address ? hostOf(address) : 'no server';
}

function hostOf(address: string): string {
    return address
        .trim()
        .replace(/^[a-z]+:\/\//i, '')
        .replace(/\/+$/, '');
}
