import type { WhatsAppApp } from '@lustre/shared';
import { Linking } from 'react-native';
import { isInstalled, openInPackage } from '../../modules/lustre-whatsapp';
import { noteWhatsApp } from '../reporting/trail';
import { type InstalledWhatsApp, WHATSAPP_PACKAGE, whatsAppTarget } from './target';

/** Read at tap time, never cached: either app can be installed or removed while this one runs. */
export function installedWhatsApp(): InstalledWhatsApp {
    return {
        regular: isInstalled(WHATSAPP_PACKAGE.regular),
        business: isInstalled(WHATSAPP_PACKAGE.business),
    };
}

/**
 * The app someone chose, whatever `installedWhatsApp` reports. False when it
 * could not take the link: nothing falls back, because Android's pick could be
 * the number they just chose against.
 */
export function openChosenWhatsApp(url: string, app: WhatsAppApp): boolean {
    const opened = openInPackage(url, WHATSAPP_PACKAGE[app]);
    noteWhatsApp({
        asked: app,
        ...installedWhatsApp(),
        opened: opened ? WHATSAPP_PACKAGE[app] : 'none',
    });
    return opened;
}

/**
 * Rejects when nothing could open the link. `branchApp` is optional because a
 * server older than the per-branch setting sends none, and a missing package
 * name made the native call throw before Android was asked anything.
 */
export async function openWhatsApp(url: string, branchApp: WhatsAppApp | null | undefined): Promise<void> {
    const asked = branchApp ?? 'regular';
    const installed = installedWhatsApp();
    const target = whatsAppTarget(installed, asked);
    const inPackage = typeof target === 'object' && openInPackage(url, target.package);
    noteWhatsApp({ asked, ...installed, opened: inPackage ? target.package : 'link' });
    if (inPackage) return;
    await Linking.openURL(url);
}
