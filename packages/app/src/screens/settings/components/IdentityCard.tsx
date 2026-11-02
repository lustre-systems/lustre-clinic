/**
 * The settings index's first card, and the reason the index opens on a dark
 * block instead of a list: `settings.html` puts the two things you reach for
 * when something is wrong — who this phone thinks you are, and whether it can
 * see the server — above every row, so neither is a screen you have to go
 * looking for. Everything below it is navigation.
 *
 * The role is the one an admin's code gave this phone, and the only way to
 * change it is another code — so the card states it and offers the scanner,
 * never a switch. It is still not a login: the phone is the account.
 *
 * A clinic on one phone (`solo`) has neither: no role to have been given and no
 * server to see. The card is then the clinic and whether it is backed up, which
 * for that clinic is what is most likely to be wrong, and it opens the backups.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Dot } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';
import type { ConnectionView } from '../data/connection';
import { ReprobeIcon, ScanCodeIcon } from './icons';

export type IdentityCardProps = {
    roleName: string;
    roleInitial: string;
    /** The clinic, under the role. Not the branch — nothing tracks which
     * branch a phone is standing in yet, so the card does not claim to. */
    clinicName: string;
    connection: ConnectionView;
    onScanCode: () => void;
    solo?: boolean;
    /** Under the clinic's name on a `solo` card. */
    soloLine?: string;
    onOpenBackups?: () => void;
    testID?: string;
};

export function IdentityCard({
    roleName,
    roleInitial,
    clinicName,
    connection,
    onScanCode,
    solo = false,
    soloLine = '',
    onOpenBackups,
    testID,
}: IdentityCardProps) {
    const t = useT();
    const title = solo ? clinicName || t('Clinic') : t(roleName);
    const initial = solo ? (clinicName.trim()[0] ?? 'C').toUpperCase() : roleInitial;
    return (
        <View style={styles.card} testID={testID}>
            <Pressable
                onPress={onOpenBackups}
                disabled={!solo || !onOpenBackups}
                accessibilityRole={solo && onOpenBackups ? 'button' : undefined}
                testID="settings-identity-backups"
            >
                <View style={styles.identity}>
                    <View style={styles.avatar}>
                        <Text variant="headline" tone="inverse">
                            {initial}
                        </Text>
                    </View>

                    <View style={styles.who}>
                        <Text variant="title3" tone="inverse" numberOfLines={1}>
                            {title}
                        </Text>
                        <Text variant="subhead" tone="inverse" numberOfLines={1} style={styles.branch}>
                            {solo ? soloLine : clinicName}
                        </Text>
                    </View>
                </View>
            </Pressable>

            {solo ? null : (
                <>
                    <View style={styles.status}>
                        <Dot tone={connection.tone} size={8} pulse={connection.pulse} />
                        <Text
                            variant="subhead"
                            weight="medium"
                            tone="inverse"
                            numberOfLines={1}
                            style={styles.statusLabel}
                        >
                            {t(connection.label)}
                        </Text>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('Check the server connection again')}
                            accessibilityState={{ busy: connection.probing }}
                            onPress={connection.reprobe}
                            disabled={connection.probing}
                            testID="settings-reprobe"
                            style={({ pressed }) => [styles.reprobe, pressed && styles.pressed]}
                        >
                            <ReprobeIcon size={13} stroke={color.inverse} width={2} />
                            <Text
                                variant="footnote"
                                weight="semibold"
                                tone="inverse"
                                style={styles.reprobeLabel}
                            >
                                {t(connection.probing ? 'Probing…' : 'Re-probe')}
                            </Text>
                        </Pressable>
                    </View>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('Scan a role code')}
                        onPress={onScanCode}
                        testID="settings-scan-code"
                        style={({ pressed }) => [styles.switch, pressed && styles.pressed]}
                    >
                        <ScanCodeIcon size={16} />
                        <Text variant="callout" weight="semibold" tone="inverse">
                            {t('Scan a role code')}
                        </Text>
                    </Pressable>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: size.bleed,
        paddingTop: space[4.5],
        paddingHorizontal: space[4.5],
        paddingBottom: space[4],
        borderRadius: radius.xl2,
        backgroundColor: color.inkDeep,
    },

    identity: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    avatar: {
        width: 46,
        height: 46,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.onDarkTrack,
    },
    who: { flex: 1, minWidth: 0 },
    branch: { opacity: 0.58, marginTop: space[0.5] },

    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        marginTop: space[4],
        paddingTop: space[3.5],
        borderTopWidth: 1,
        borderTopColor: color.onDarkLine,
    },
    statusLabel: { flex: 1, opacity: 0.7 },
    reprobe: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], paddingVertical: space[1] },
    reprobeLabel: { opacity: 0.85 },

    switch: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1.5],
        marginTop: space[3],
        minHeight: 46,
        padding: space[3],
        borderRadius: radius.lg,
        backgroundColor: color.onDarkLine,
    },
    pressed: { opacity: 0.6 },
});
