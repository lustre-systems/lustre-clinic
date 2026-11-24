import type { WhatsAppApp } from '@lustre/shared';
import { Linking } from 'react-native';
import { isInstalled, openInPackage } from '../../modules/lustre-whatsapp';
import { noteWhatsApp } from '../reporting/trail';
import { type InstalledWhatsApp, WHATSAPP_PACKAGE, whatsAppTarget } from './target';

export function installedWhatsApp(): InstalledWhatsApp {
    return {
        regular: isInstalled(WHATSAPP_PACKAGE.regular),
        business: isInstalled(WHATSAPP_PACKAGE.business),
    };
}

export function openChosenWhatsApp(url: string, app: WhatsAppApp): boolean {
    const opened = openInPackage(url, WHATSAPP_PACKAGE[app]);
    noteWhatsApp({
        asked: app,
        ...installedWhatsApp(),
        opened: opened ? WHATSAPP_PACKAGE[app] : 'none',
    });
    return opened;
}

export async function openWhatsApp(url: string, branchApp: WhatsAppApp | null | undefined): Promise<void> {
    const asked = branchApp ?? 'regular';
    const installed = installedWhatsApp();
    const target = whatsAppTarget(installed, asked);
    const inPackage = typeof target === 'object' && openInPackage(url, target.package);
    noteWhatsApp({ asked, ...installed, opened: inPackage ? target.package : 'link' });
    if (inPackage) return;
    await Linking.openURL(url);
}
