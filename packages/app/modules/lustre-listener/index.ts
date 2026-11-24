import { requireOptionalNativeModule } from 'expo';

export interface ListenerNotice {
    title: string;
    body: string;
    channelName: string;
    publicTitle?: string;
    action?: { label: string; id: string; pendingBody: string };
}

interface NativeNotice {
    title: string;
    body: string;
    channelName: string;
    publicTitle: string | null;
    actionLabel: string | null;
    actionId: string | null;
    pendingBody: string | null;
}

interface LustreListenerNative {
    start(notice: NativeNotice): boolean;
    update(notice: NativeNotice): boolean;
    stop(): void;
    addListener(event: 'onFinish', listener: (payload: { id: string }) => void): { remove(): void };
}

const native = requireOptionalNativeModule<LustreListenerNative>('LustreListener');

export const LISTENER_TASK = 'LustreListener';

function toNative(notice: ListenerNotice): NativeNotice {
    return {
        title: notice.title,
        body: notice.body,
        channelName: notice.channelName,
        publicTitle: notice.publicTitle ?? null,
        actionLabel: notice.action?.label ?? null,
        actionId: notice.action?.id ?? null,
        pendingBody: notice.action?.pendingBody ?? null,
    };
}

export function startListening(notice: ListenerNotice): boolean {
    return native?.start(toNative(notice)) ?? false;
}

export function updateListening(notice: ListenerNotice): boolean {
    return native?.update(toNative(notice)) ?? false;
}

export function stopListening(): void {
    native?.stop();
}

export function onListenerAction(listener: (id: string) => void): () => void {
    const subscription = native?.addListener('onFinish', ({ id }) => listener(id));
    return () => subscription?.remove();
}
