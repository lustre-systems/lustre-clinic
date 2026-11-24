// biome-ignore lint/style/noRestrictedImports: the Reveal tween is an animation driven by the switch
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import {
    CardDivider,
    duration,
    easing,
    NumericField,
    Switch,
    TextField,
    useReducedMotion,
} from '../../../components/ui';
import { useT } from '../../../i18n';
import { space, Text } from '../../../theme';
import type { OldField, OldPatientForm, PatientForm } from '../patientForm';
import { owesInput } from '../patientForm';

export type OldPatientProps = {
    form: PatientForm;
    onChange: (patch: Partial<PatientForm>) => void;
    blank: OldField[];
    errors: Partial<Record<OldField, string>>;
};

export function OldPatientRows({ form, onChange, blank, errors }: OldPatientProps) {
    const t = useT();
    const old = form.old;
    const change = (patch: Partial<OldPatientForm>) => onChange({ old: { ...old, ...patch } });

    return (
        <>
            <View style={styles.switchRow}>
                <View style={styles.switchText}>
                    <Text variant="callout" weight="medium">
                        {t('Already a patient here')}
                    </Text>
                    <Text variant="caption" tone="muted">
                        {t('They have a number from before the clinic moved over.')}
                    </Text>
                </View>
                <Switch
                    value={old.on}
                    onValueChange={(on) => change({ on })}
                    accessibilityLabel="Old patient"
                    testID="patient-old-switch"
                />
            </View>

            <Reveal open={old.on}>
                <CardDivider />
                <View style={styles.fields}>
                    <TextField
                        label="Old ref number"
                        required
                        value={old.ref}
                        onChangeText={(ref) => change({ ref })}
                        placeholder="710"
                        due={blank.includes('ref')}
                        hint="The number on the front of their paper file. It becomes their patient number here."
                        autoCapitalize="characters"
                        testID="patient-old-ref"
                    />
                    <NumericField
                        label="Owes"
                        value={old.owes}
                        onChangeText={(text) => change({ owes: owesInput(text) })}
                        placeholder="0"
                        prefix="EGP"
                        error={errors.owes}
                        keyboardType="number-pad"
                        size="body"
                        hint="What they still owed the old system. Leave blank if nothing."
                        testID="patient-old-owes"
                    />
                </View>
            </Reveal>
        </>
    );
}

function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
    const [contentHeight, setContentHeight] = useState(0);
    const reducedMotion = useReducedMotion();
    const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

    useEffect(() => {
        const to = open ? 1 : 0;
        if (reducedMotion) {
            progress.setValue(to);
            return;
        }
        const tween = Animated.timing(progress, {
            toValue: to,
            duration: duration.fadeup,
            easing: easing.promote,
            useNativeDriver: false,
        });
        tween.start();
        return () => tween.stop();
    }, [open, reducedMotion, progress]);

    const height = progress.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] });
    const opacity = progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.85, 1] });
    const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-space[2], 0] });

    return (
        <Animated.View
            style={[styles.reveal, { height, opacity }]}
            pointerEvents={open ? 'auto' : 'none'}
            accessibilityElementsHidden={!open}
            importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        >
            <Animated.View
                onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
                style={[styles.revealBody, { transform: [{ translateY }] }]}
            >
                {children}
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[3.5],
        paddingVertical: space[3],
    },
    switchText: { flex: 1, gap: space[0.5] },

    reveal: { overflow: 'hidden' },
    revealBody: { position: 'absolute', start: 0, end: 0, top: 0 },

    fields: { paddingHorizontal: space[3.5], paddingVertical: space[3.5], gap: space[4] },
});
