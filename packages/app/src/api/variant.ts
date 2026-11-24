import type { ServerAddresses } from './config';

export type BuildVariant = 'dev' | 'demo' | 'prod';

export function variantOf(build: {
    dev: boolean;
    shippedDemo: boolean;
    applicationId?: string | null;
}): BuildVariant {
    if (build.dev || build.applicationId === 'com.lustre.clinic.dev') return 'dev';
    return build.shippedDemo ? 'demo' : 'prod';
}

export function allowsLan(variant: BuildVariant): boolean {
    return variant !== 'prod';
}

export function allowsDemo(variant: BuildVariant): boolean {
    return variant !== 'prod';
}

export function acceptsServer(variant: BuildVariant, environment: unknown): boolean {
    return variant !== 'dev' || environment === 'development';
}

export function picksDevRole(variant: BuildVariant): boolean {
    return variant === 'dev';
}

export function showsDevBanner(variant: BuildVariant): boolean {
    return variant === 'dev';
}

export function bootAddresses(
    variant: BuildVariant,
    configured: ServerAddresses,
    devServer: string | null,
): ServerAddresses {
    if (variant !== 'dev' || configured.lan) return configured;
    return { ...configured, lan: devServer };
}

export function isTailnetAddress(address: string): boolean {
    const host = hostOf(address);
    if (host.endsWith('.ts.net') || host.startsWith('fd7a:115c:a1e0:')) return true;
    const octets = host.split('.');
    if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet))) return false;
    const [first, second] = octets.map(Number);
    return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

function hostOf(address: string): string {
    const rest = address
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '');
    const authority = rest.split(/[/?#]/)[0] ?? '';
    const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);
    const bracketed = hostAndPort.match(/^\[([^\]]+)\]/);
    if (bracketed?.[1]) return bracketed[1];
    if ((hostAndPort.match(/:/g) ?? []).length > 1) return hostAndPort;
    return (hostAndPort.split(':')[0] ?? '').replace(/\.$/, '');
}

export function usableAddresses(variant: BuildVariant, addresses: ServerAddresses): ServerAddresses {
    if (allowsLan(variant)) return addresses;
    const { tailscale } = addresses;
    return { lan: null, tailscale: tailscale && isTailnetAddress(tailscale) ? tailscale : null };
}
