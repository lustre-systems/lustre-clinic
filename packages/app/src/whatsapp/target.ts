import type { WhatsAppApp } from '@lustre/shared';

export const WHATSAPP_PACKAGE = {
    regular: 'com.whatsapp',
    business: 'com.whatsapp.w4b',
} as const satisfies Record<WhatsAppApp, string>;

export type InstalledWhatsApp = Readonly<Record<WhatsAppApp, boolean>>;

export type WhatsAppTarget = { package: string } | 'browser';

export function whatsAppTarget(installed: InstalledWhatsApp, branchApp: WhatsAppApp): WhatsAppTarget {
    if (installed.regular && installed.business) return { package: WHATSAPP_PACKAGE[branchApp] };
    if (installed.regular) return { package: WHATSAPP_PACKAGE.regular };
    if (installed.business) return { package: WHATSAPP_PACKAGE.business };
    return 'browser';
}
