import { requireOptionalNativeModule } from 'expo';

interface LustreWhatsAppNative {
    isInstalled(packageName: string): boolean;
    openInPackage(url: string, packageName: string): boolean;
}

const native = requireOptionalNativeModule<LustreWhatsAppNative>('LustreWhatsApp');

export function isInstalled(packageName: string): boolean {
    return native?.isInstalled(packageName) ?? false;
}

export function openInPackage(url: string, packageName: string): boolean {
    return native?.openInPackage(url, packageName) ?? false;
}
