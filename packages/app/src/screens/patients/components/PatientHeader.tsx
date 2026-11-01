/**
 * Who this is, and the two ways to reach them — `patient-view.html`. The name
 * gets the title size and wraps rather than truncating: an Egyptian record holds
 * four-part names in two scripts, and a clipped name is the wrong patient.
 *
 * The meta line is mono because every part of it is a figure read aloud or typed
 * into a keypad. Sex and age come off the record; either can be missing, and the
 * separators collapse rather than leaving a stranded interpunct.
 *
 * WhatsApp is filled green and Call is outlined because the clinic messages far
 * more than it rings — and per PRODUCT.md the app never sends: `wa.me` opens the
 * chat with the user's own WhatsApp, and they type. Both are `Linking`, so both
 * are a round trip out of the app and back.
 *
 * The button always asks which WhatsApp to open, because a phone can have an app
 * that `installedWhatsApp` does not report. It tries the chosen app whatever that
 * says, and never hands the link to Android, which could open the other number.
 */

import type { WhatsAppApp } from '@lustre/shared';
import { Fragment, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { phoneText } from '../../../components/domain';
import { Sheet } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, containsArabic, radius, size, space, Text } from '../../../theme';
import { openChosenWhatsApp } from '../../../whatsapp';
import type { Patient } from '../data/types';
import { sentenceCase } from './format';
import { CallIcon, WhatsAppIcon } from './icons';

export type PatientHeaderProps = {
    patient: Patient;
    onFailed: (message: string) => void;
};

const WHATSAPP_CHOICES: readonly { app: WhatsAppApp; label: string }[] = [
    { app: 'regular', label: 'WhatsApp' },
    { app: 'business', label: 'WhatsApp Business' },
];

export function PatientHeader({ patient, onFailed }: PatientHeaderProps) {
    const t = useT();
    const [choosing, setChoosing] = useState(false);
    // A ref, not state: the sheet's dismiss callback can be a render behind.
    const chosen = useRef<WhatsAppApp | null>(null);

    const open = (url: string, failure: string) => {
        void Linking.openURL(url).catch(() => onFailed(failure));
    };

    const message = (app: WhatsAppApp) => {
        if (!openChosenWhatsApp(whatsAppUrl(patient.phone), app)) {
            onFailed("That WhatsApp didn't open. Try the other one.");
        }
    };

    return (
        <View style={styles.header}>
            <View style={styles.identity}>
                <Text variant="title" weight="semibold" style={styles.name}>
                    {patient.name}
                </Text>

                <View style={styles.meta}>
                    <RefChip value={patient.ref} />

                    {metaParts(patient, t).map((part, index) => (
                        <Fragment key={part}>
                            {/* A rule, not an interpunct: the design separates two
                                figures with a hairline bar so neither reads as
                                punctuation inside the number. */}
                            {index > 0 ? <View style={styles.divider} /> : null}
                            <Text
                                variant="subhead"
                                script={containsArabic(part) ? undefined : 'mono'}
                                tone="muted"
                            >
                                {part}
                            </Text>
                        </Fragment>
                    ))}
                </View>
            </View>

            <View style={styles.actions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('WhatsApp {name}', { name: patient.name })}
                    onPress={() => setChoosing(true)}
                    style={({ pressed }) => [styles.action, styles.whatsApp, pressed && styles.pressed]}
                >
                    <WhatsAppIcon size={18} stroke={color.inverse} />
                </Pressable>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Call {name}', { name: patient.name })}
                    onPress={() => open(`tel:${patient.phone}`, 'The dialler could not be opened.')}
                    style={({ pressed }) => [styles.action, styles.call, pressed && styles.pressed]}
                >
                    <CallIcon size={17} stroke={color.ink} />
                </Pressable>
            </View>

            <Sheet
                visible={choosing}
                onClose={() => setChoosing(false)}
                // Leaving the app waits for the sheet to finish leaving, as any
                // answer that changes the screen underneath does.
                onClosed={() => {
                    if (chosen.current) message(chosen.current);
                    chosen.current = null;
                }}
                title="Open WhatsApp in"
            >
                <View style={styles.choices}>
                    {WHATSAPP_CHOICES.map(({ app, label }) => (
                        <Pressable
                            key={app}
                            accessibilityRole="menuitem"
                            onPress={() => {
                                chosen.current = app;
                                setChoosing(false);
                            }}
                            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
                        >
                            <Text variant="body">{t(label)}</Text>
                        </Pressable>
                    ))}
                </View>
            </Sheet>
        </View>
    );
}

/**
 * The clinic's own number for this patient, and **the one ref anywhere in the
 * app** (§5). It leads the meta line because it is what the desk copies onto the
 * top of the patient's page in the paper book, and a number you have to hunt for
 * is a number that gets written down wrong.
 *
 * Drawn as a chip rather than as another part of the line: the rest of the line
 * is muted mono figures, and a fourth one would read as a second phone number.
 */
function RefChip({ value }: { value: string }) {
    const t = useT();
    return (
        <View style={styles.ref} accessibilityLabel={t('Patient reference {ref}', { ref: value })}>
            <Text variant="tag" weight="bold" script="mono">
                {value}
            </Text>
        </View>
    );
}

/** `Female, 34` and `+201004001008` — with whatever of it the record actually holds. */
function metaParts(patient: Patient, t: (copy: string) => string): string[] {
    const sex = sentenceCase(patient.gender);
    const who = [sex && t(sex), patient.age === null ? null : String(patient.age)].filter(Boolean).join(', ');

    // The old system's number is not one of these: a third mono figure on this
    // line would read as a second phone number.
    return [who, patient.phone && phoneText(patient.phone)].filter((part): part is string => Boolean(part));
}

/** `wa.me` wants the number without a `+` or separators. */
function whatsAppUrl(phone: string): string {
    return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

const styles = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
    identity: { flex: 1, gap: space[1.5] },
    name: { flexShrink: 1 },
    ref: {
        paddingHorizontal: space[2],
        paddingVertical: space[1],
        borderRadius: radius.sm,
        borderWidth: border.hair,
        borderColor: color.outline,
    },
    meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2.5] },
    divider: { width: 1, height: 11, backgroundColor: color.outline },
    actions: { flexDirection: 'row', gap: space[2], paddingTop: space[0.5] },
    action: {
        width: 40,
        height: 40,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    whatsApp: { backgroundColor: color.wa },
    call: { borderWidth: border.thick, borderColor: color.outline },
    pressed: { opacity: 0.6 },
    choices: { alignSelf: 'stretch' },
    choice: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: size.row,
        paddingVertical: space[2],
    },
});
