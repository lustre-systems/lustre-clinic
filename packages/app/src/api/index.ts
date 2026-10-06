// The one entry point. Screens import from `../api`, never from a file inside it.

export { ApiProvider, useTRPC } from './ApiProvider';
export { api, trpcClient } from './client';
export { adoptClinicZone, hydrateClinicZone } from './clinicZone';
export type { ServerAddresses } from './config';
export { BUILD_VARIANT, serverAddresses, setServerAddresses } from './config';
export type { AddressKind, ConnectionStatus } from './connection';
export { getConnectionState, lastProbeRefused, reprobe } from './connection';
export type { Credential, Refusal } from './credential';
export {
    forgetServerCredential,
    grantCredential,
    markFreshInstall,
    retryProvisioning,
    useCredential,
} from './credential';
export { dataGeneration, subscribeToDataReset } from './dataReset';
export {
    becomeInDemo,
    disableLocalMode,
    enableDemoMode,
    isDemoMode,
    isLocalMode,
    resetDemoData,
    startLocalMode,
    useDemoMode,
    useDeviceBackend,
} from './demo';
export { classifyError, errorCodeOf, isOffline, isSlotOverlap } from './errors';
export { onServerChange, onServerEvent } from './live';
export { clockSample, noteServerClock, phoneTimeOf, serverNow, serverToday } from './serverClock';
export type { Area } from './serverEvents';
export type { RouterOutput } from './types';
export { useConnection } from './useConnection';
export type { BuildVariant } from './variant';
export { allowsDemo, allowsLan, isTailnetAddress, picksDevRole, showsDevBanner } from './variant';
