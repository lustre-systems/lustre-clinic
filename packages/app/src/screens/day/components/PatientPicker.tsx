import { Pressable, StyleSheet, View } from 'react-native';
import { phoneText } from '../../../components/domain';
import { Button, SearchField } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { api, type Patient, useLocalQuery } from '../data';
import type { PatientDraft } from '../patientDraft';
import { useDebounced } from '../useDebounced';

export type PatientPickerProps = {
    value: PatientDraft;
    onChange: (next: PatientDraft) => void;
    active: boolean;
    onRegisterNew: () => void;
};

export function PatientPicker({ value, onChange, active, onRegisterNew }: PatientPickerProps) {
    const query = useDebounced(value.term.trim(), 250);

    const search = useLocalQuery<Patient[]>(
        `patients:${query}`,
        () => (query.length >= 2 ? api.searchPatients(query) : Promise.resolve([])),
        { enabled: active },
    );

    return (
        <View style={styles.step}>
            <View style={styles.section}>
                <SearchField
                    value={value.term}
                    onChangeText={(term) => onChange({ ...value, term, picked: null })}
                    onClear={() => onChange({ ...value, term: '', picked: null })}
                    variant="sheet"
                    placeholder="Name or phone"
                    autoCorrect={false}
                />

                <PatientResults
                    term={value.term}
                    results={search.data ?? []}
                    loading={search.status === 'loading'}
                    failed={search.status === 'error'}
                    picked={value.picked}
                    onPick={(picked) => onChange({ ...value, picked })}
                    onRetry={search.refetch}
                />
            </View>

            <View style={styles.register}>
                <Button
                    label="Register a new patient"
                    variant="text"
                    size="md"
                    onPress={onRegisterNew}
                    testID="book-register-new"
                />
            </View>
        </View>
    );
}

function PatientResults({
    term,
    results,
    loading,
    failed,
    picked,
    onPick,
    onRetry,
}: {
    term: string;
    results: readonly Patient[];
    loading: boolean;
    failed: boolean;
    picked: Patient | null;
    onPick: (patient: Patient) => void;
    onRetry: () => void;
}) {
    const t = useT();
    if (term.trim().length < 2) return null;

    if (loading) {
        return (
            <Text variant="subhead" tone="muted">
                {t('Searching…')}
            </Text>
        );
    }

    if (failed) {
        return (
            <View style={styles.resultsError}>
                <Text variant="subhead" tone="due">
                    {t('The patient list could not be searched.')}
                </Text>
                <Button label="Try again" variant="text" size="md" onPress={onRetry} />
            </View>
        );
    }

    if (results.length === 0) {
        return (
            <Text variant="subhead" tone="muted">
                {t('Nobody matches. If they are new here, register them below.')}
            </Text>
        );
    }

    return (
        <View style={styles.results}>
            {results.map((patient) => (
                <Pressable
                    key={patient.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: picked?.id === patient.id }}
                    onPress={() => onPick(patient)}
                    style={({ pressed }) => [
                        styles.result,
                        picked?.id === patient.id && styles.resultPicked,
                        pressed && styles.resultPressed,
                    ]}
                >
                    <Text variant="body" weight="medium" numberOfLines={1}>
                        {patient.name}
                    </Text>
                    <Text variant="subhead" tone="muted">
                        {phoneText(patient.phone)}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    step: { gap: space[4] },
    section: { gap: space[3] },
    register: {
        paddingTop: space[2],
        borderTopWidth: border.hair,
        borderTopColor: color.line,
    },
    results: { gap: space[2] },
    resultsError: { gap: space[2] },
    result: {
        minHeight: size.row,
        justifyContent: 'center',
        gap: space[0.5],
        paddingHorizontal: space[3],
        paddingVertical: space[2],
        borderRadius: radius.md,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    resultPicked: { borderColor: color.ink, borderWidth: border.thick },
    resultPressed: { backgroundColor: color.surface2 },
});
