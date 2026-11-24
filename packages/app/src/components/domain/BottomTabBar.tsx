import { type Role, seesStats } from '@lustre/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import { border, color, radius, size, space, Text } from '../../theme';
import { useKeyboardHeight } from '../ui';
import { GLYPH, type Glyph } from './icons';

export type TabKey = 'day' | 'patients' | 'stats' | 'settings';

export type BottomTabBarProps = {
    active: TabKey;
    role: Role;
    granted: Role | null;
    solo?: boolean;
    onChange: (tab: TabKey) => void;
};

export function showsStats(granted: Role | null, view: Role): boolean {
    if (granted === null) return seesStats(null) && view !== 'secretary';
    return seesStats(granted);
}

const SIZE = 22;
const STROKE = 2;

const ROLE_ICON: Record<Role, Glyph> = {
    admin: GLYPH.roles,
    doctor: GLYPH.procedure,
    secretary: GLYPH.desk,
};

const ROLE_LABEL: Record<Role, string> = {
    admin: 'Admin',
    doctor: 'Doctor',
    secretary: 'Secretary',
};

const TAB_ICON: Record<Exclude<TabKey, 'settings'>, Glyph> = {
    day: GLYPH.day,
    patients: GLYPH.patients,
    stats: GLYPH.stats,
};

export function BottomTabBar({ active, role, granted, solo = false, onChange }: BottomTabBarProps) {
    const t = useT();
    const insets = useSafeAreaInsets();
    const keyboard = useKeyboardHeight();
    const RoleGlyph = solo ? GLYPH.clinic : ROLE_ICON[role];

    if (keyboard > 0) return null;

    const every: { key: TabKey; label: string }[] = [
        { key: 'day', label: 'Day' },
        { key: 'patients', label: 'Patients' },
        { key: 'stats', label: 'Stats' },
        { key: 'settings', label: solo ? 'Settings' : ROLE_LABEL[role] },
    ];
    const tabs = every.filter((tab) => tab.key !== 'stats' || showsStats(granted, role));

    return (
        <View style={[styles.bar, { paddingBottom: space[3] + insets.bottom }]} testID="tab-bar">
            {tabs.map((tab) => {
                const selected = tab.key === active;
                const stroke = selected ? color.ink : color.muted;
                const Glyph = tab.key === 'settings' ? RoleGlyph : TAB_ICON[tab.key];
                return (
                    <Pressable
                        key={tab.key}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        accessibilityLabel={t(tab.label)}
                        onPress={() => onChange(tab.key)}
                        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
                        testID={`tab-${tab.key}`}
                    >
                        <Glyph size={SIZE} color={stroke} strokeWidth={STROKE} />
                        <Text
                            variant="caption"
                            weight={selected ? 'semibold' : 'medium'}
                            tone={selected ? 'ink' : 'muted'}
                        >
                            {t(tab.label)}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'stretch',
        paddingTop: space[2.5],
        backgroundColor: color.canvas,
        borderTopWidth: border.hair,
        borderTopColor: color.line,
    },
    tab: {
        flex: 1,
        minHeight: size.row,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1.5],
        paddingVertical: space[1],
        borderRadius: radius.md,
    },
    pressed: { backgroundColor: color.surface2 },
});
