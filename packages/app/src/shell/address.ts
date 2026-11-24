export interface ServerCandidate {
    lan: string;
    tailscale: string;
}

export function toBase(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function toCandidate(typed: ServerCandidate, lanAllowed: boolean): ServerCandidate {
    return { lan: lanAllowed ? toBase(typed.lan) : '', tailscale: toBase(typed.tailscale) };
}

export const NOT_ON_TAILNET =
    "That is not a Tailscale address. Use the clinic computer's name ending in .ts.net, or its 100.x address.";

export function nothingEntered(lanAllowed: boolean): string {
    return lanAllowed ? 'Enter at least one address.' : 'Enter the Tailscale address.';
}

export const NOT_DEV_SERVER =
    "That is the clinic's own server. A dev build connects only to the dev server, on port 3001.";

export function noAnswer(candidate: ServerCandidate): string {
    const both = candidate.lan && candidate.tailscale;
    if (both) {
        return 'Neither address answered. Check the clinic computer is on, that you are on the clinic wifi or signed in to Tailscale, and that the address ends in the port (:3000).';
    }
    return candidate.lan
        ? 'That address did not answer. Check the clinic computer is on, that you are on the clinic wifi or signed in to Tailscale, and that the address ends in the port (:3000).'
        : 'That address did not answer. Check the clinic computer is on, that you are signed in to Tailscale, and that the address ends in the port (:3000).';
}
