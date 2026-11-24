import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Card, CardDivider, Placeholder } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, font, radius, space, Text, type } from '../../../theme';
import type { BasicsField, PatientForm } from '../patientForm';
import { ageDigits, FEMALE, MALE } from '../patientForm';

export type BasicsCardProps = {
    form: PatientForm;
    onChange: (patch: Partial<PatientForm>) => void;
    blank: BasicsField[];
    errors: Partial<Record<BasicsField, string>>;
    trailing?: ReactNode;
    ref?: 'hidden' | 'locked' | 'editable';
    refError?: string;
};

export function BasicsCard({
    form,
    onChange,
    blank,
    errors,
    trailing,
    ref: refMode = 'hidden',
    refError,
}: BasicsCardProps) {
    const t = useT();
    const owed = new Set(blank);
    const [refLeft, setRefLeft] = useState(false);

    const [left, setLeft] = useState<BasicsField[]>([]);
    const seen = new Set(left);

    function leave(field: BasicsField) {
        setLeft((fields) => (fields.includes(field) ? fields : [...fields, field]));
    }

    function shown(field: BasicsField) {
        return seen.has(field) ? errors[field] : undefined;
    }

    function due(field: BasicsField) {
        return owed.has(field) || errors[field] !== undefined;
    }

    return (
        <View>
            <Card>
                {refMode !== 'hidden' ? (
                    <>
                        <Row
                            label="Ref"
                            error={refLeft ? refError : undefined}
                            owed={refError !== undefined}
                            align="center"
                        >
                            {refMode === 'editable' ? (
                                <TextInput
                                    accessibilityLabel="Patient number"
                                    value={form.ref}
                                    onChangeText={(ref) => onChange({ ref })}
                                    onBlur={() => setRefLeft(true)}
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    style={[styles.value, styles.mono]}
                                    testID="patient-ref"
                                />
                            ) : (
                                <Text
                                    variant="callout"
                                    style={styles.mono}
                                    accessibilityLabel={t('Patient number {ref}', { ref: form.ref })}
                                    testID="patient-ref-locked"
                                >
                                    {form.ref}
                                </Text>
                            )}
                        </Row>
                        <CardDivider />
                    </>
                ) : null}

                <Row label="Full name" error={shown('name')} owed={due('name')}>
                    <TextInput
                        accessibilityLabel="Full name"
                        value={form.name}
                        onChangeText={(name) => onChange({ name })}
                        onBlur={() => leave('name')}
                        autoCapitalize="words"
                        style={[styles.value, styles.sans]}
                        testID="patient-name"
                    />
                    <Placeholder text="As it is on the card" visible={form.name === ''} variant="callout" />
                </Row>

                <CardDivider />

                <Row label="Phone" error={shown('phone')} owed={due('phone')}>
                    <TextInput
                        accessibilityLabel="Phone"
                        value={form.phone}
                        onChangeText={(phone) => onChange({ phone })}
                        onBlur={() => leave('phone')}
                        keyboardType="phone-pad"
                        style={[styles.value, styles.mono]}
                        testID="patient-phone"
                    />
                    <Placeholder text="01xx xxx xxxx" visible={form.phone === ''} variant="callout" />
                </Row>

                <CardDivider />

                <Row label="Email" error={shown('email')} owed={due('email')}>
                    <TextInput
                        accessibilityLabel="Email"
                        value={form.email}
                        onChangeText={(email) => onChange({ email })}
                        onBlur={() => leave('email')}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={[styles.value, styles.sans]}
                        testID="patient-email"
                    />
                    <Placeholder text="Optional" visible={form.email === ''} variant="callout" />
                </Row>

                <CardDivider />

                <Row label="Age · sex" error={shown('age')} owed={due('age') || due('gender')} align="center">
                    <View style={styles.ageSex}>
                        <View style={styles.age}>
                            <TextInput
                                accessibilityLabel="Age"
                                value={form.age}
                                onChangeText={(text) => onChange({ age: ageDigits(text) })}
                                onBlur={() => leave('age')}
                                keyboardType="number-pad"
                                style={[styles.value, styles.mono]}
                                testID="patient-age"
                            />
                            <Placeholder text="—" visible={form.age === ''} variant="callout" />
                        </View>

                        <SexToggle value={form.gender} onChange={(gender) => onChange({ gender })} />
                    </View>
                </Row>

                {trailing ? (
                    <>
                        <CardDivider />
                        {trailing}
                    </>
                ) : null}
            </Card>
        </View>
    );
}

function Row({
    label,
    error,
    owed = false,
    align = 'flex-start',
    children,
}: {
    label: string;
    error?: string;
    owed?: boolean;
    align?: 'center' | 'flex-start';
    children: ReactNode;
}) {
    const t = useT();
    return (
        <View style={styles.row}>
            <View style={[styles.line, align === 'center' && styles.lineCentred]}>
                <Text variant="footnote" tone={owed ? 'due' : 'muted'} style={styles.label}>
                    {t(label)}
                </Text>
                <View style={styles.field}>{children}</View>
            </View>

            {error ? (
                <Text variant="caption" tone="danger" style={styles.error}>
                    {t(error)}
                </Text>
            ) : null}
        </View>
    );
}

function SexToggle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel="Sex">
            <Half
                label="F"
                selected={value === FEMALE}
                onPress={() => onChange(value === FEMALE ? '' : FEMALE)}
            />
            <Half label="M" selected={value === MALE} onPress={() => onChange(value === MALE ? '' : MALE)} />
        </View>
    );
}

function Half({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    const t = useT();
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t(label === 'F' ? 'Female' : 'Male')}
            onPress={onPress}
            style={({ pressed }) => [styles.half, selected && styles.halfOn, pressed && styles.pressed]}
            testID={`patient-sex-${label}`}
        >
            <Text variant="footnote" weight="semibold" tone={selected ? 'inverse' : 'muted'}>
                {label}
            </Text>
        </Pressable>
    );
}

const LABEL_WIDTH = 78;

const styles = StyleSheet.create({
    row: { paddingHorizontal: space[3.5], paddingVertical: space[3] },
    line: { flexDirection: 'row', gap: space[3] },
    lineCentred: { alignItems: 'center' },
    label: { width: LABEL_WIDTH, flexGrow: 0, flexShrink: 0, paddingTop: space[0.5] },
    field: { flex: 1, justifyContent: 'center' },
    error: { paddingTop: space[1], marginStart: LABEL_WIDTH + space[3] },

    value: { ...type.callout, color: color.ink, padding: 0, minHeight: type.callout.lineHeight },
    sans: { fontFamily: font.sans.semibold },
    mono: { fontFamily: font.mono.medium },

    ageSex: { flexDirection: 'row', alignItems: 'center', gap: space[2.5] },
    age: { minWidth: 34, justifyContent: 'center' },

    toggle: {
        flexDirection: 'row',
        padding: 3,
        borderRadius: radius.full,
        backgroundColor: color.surface2,
    },
    half: {
        minWidth: 34,
        paddingHorizontal: space[3],
        paddingVertical: space[1.5],
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    halfOn: { backgroundColor: color.ink },
    pressed: { opacity: 0.6 },
});
