import { type CopyVars, type Locale, localizeCopy } from '@lustre/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    // biome-ignore lint/style/noRestrictedImports: synchronizes locale state with React Native's process-wide layout-direction API
    useEffect,
    useMemo,
    useSyncExternalStore,
} from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';
import { hydratingSubscribe } from '../shell/hydratingSubscribe';
import { setRuntimeLocale } from './runtime';

const LOCALE_KEY = 'lustre.locale';
const DEFAULT_LOCALE: Locale = 'en';
let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

function emit(next: Locale): void {
    current = next;
    setRuntimeLocale(next);
    for (const listener of listeners) listener();
}

async function hydrate(): Promise<void> {
    const stored = await AsyncStorage.getItem(LOCALE_KEY).catch(() => null);
    if ((stored === 'en' || stored === 'ar') && stored !== current) emit(stored);
}

const subscribe = hydratingSubscribe(listeners, hydrate);
const getSnapshot = () => current;

export function setLocale(next: Locale): void {
    if (next === current) return;
    emit(next);
    void AsyncStorage.setItem(LOCALE_KEY, next).catch(() => undefined);
}

type LocaleContextValue = {
    locale: Locale;
    isRTL: boolean;
    t: (copy: string, vars?: CopyVars) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
    const locale = useSyncExternalStore(subscribe, getSnapshot);
    const isRTL = locale === 'ar';
    const t = useCallback((copy: string, vars?: CopyVars) => localizeCopy(locale, copy, vars), [locale]);

    useEffect(() => {
        I18nManager.allowRTL(true);
        I18nManager.swapLeftAndRightInRTL(true);
        if (I18nManager.isRTL !== isRTL) I18nManager.forceRTL(isRTL);
    }, [isRTL]);

    const value = useMemo(() => ({ locale, isRTL, t }), [locale, isRTL, t]);
    return (
        <LocaleContext.Provider value={value}>
            <View style={[styles.root, { direction: isRTL ? 'rtl' : 'ltr' }]}>{children}</View>
        </LocaleContext.Provider>
    );
}

function useLocaleContext(): LocaleContextValue {
    const value = useContext(LocaleContext);
    if (!value) throw new Error('LocaleProvider is missing');
    return value;
}

export function useLocale(): Locale {
    return useLocaleContext().locale;
}

export function useIsRTL(): boolean {
    return useLocaleContext().isRTL;
}

export function useT(): (copy: string, vars?: CopyVars) => string {
    return useLocaleContext().t;
}

const styles = StyleSheet.create({ root: { flex: 1 } });
