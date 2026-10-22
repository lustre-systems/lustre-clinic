/**
 * The app's global navigation: four items, 22px stroked icons over an 11px
 * label, the active tab in `ink` and the rest in `muted`. The bar sits in flow
 * at the bottom of the shell rather than absolutely positioned, and carries the
 * bottom safe-area inset itself — an absolute position would put the labels
 * under Android's own gesture bar.
 *
 * The fourth tab says the role — "Doctor" or "Secretary", over a stethoscope or
 * a headset — because the device is the account and that is the one thing about
 * the app worth knowing before you tap anything. What changed is where it goes:
 * it used to flip the role in place, which meant a mis-tap silently changed what
 * the app could do and left Settings with no way in at all. Now it opens
 * Settings, and the role is the card at the top of that screen with a sheet that
 * says what switching changes before it changes anything.
 *
 * Only the admin's phone has the Stats tab (`seesStats`): the server refuses
 * its reads to every other role, so a tab of refusals is all it could be.
 *
 * `settings.html` labels this tab "Settings" over a gear. Naming the role is a
 * deliberate departure: the gear is the same on both phones, and which phone
 * this is answers more questions than what the screen contains.
 */
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
    /** The fourth tab's glyph and its label both come from this. */
    role: Role;
    /** Null for a phone with no role code yet, which keeps every tab. Stats is a tab only for the admin. */
    granted: Role | null;
    /**
     * A clinic on one phone: there is no other phone to tell this one apart
     * from, so the fourth tab is plainly Settings.
     */
    solo?: boolean;
    onChange: (tab: TabKey) => void;
};

/**
 * Whether this phone has the Stats tab. A role code decides it (`seesStats`).
 * A phone with no code yet counts as the owner's, but one whose day view is
 * set to the desk is the desk's, and the desk does not see the clinic's
 * figures.
 */
export function showsStats(granted: Role | null, view: Role): boolean {
    if (granted === null) return seesStats(null) && view !== 'secretary';
    return seesStats(granted);
}

const SIZE = 22;
const STROKE = 2;

/**
 * The fourth tab opens Settings, but its glyph is the role this device is on —
 * a stethoscope for the doctor, a headset for the desk. It is the one thing
 * about the app that is true before you tap anything, and the tab is where it
 * belongs now that the role is no longer a tab of its own.
 */
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

    // Out of the layout while typing. The keyboard covers it anyway, and while it
    // stays in flow every bar above it — a pane's action bar, the visit dock —
    // is lifted by the keyboard from the top of the tab bar rather than from the
    // bottom of the window, and floats a tab bar's height clear of the keys.
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
