import type { ClinicType } from '@lustre/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTRPC } from '../../api';
import {
    ActionBar,
    Callout,
    Card,
    DropdownField,
    type DropdownOption,
    NumericField,
    SectionLabel,
    TextField,
    Toast,
    usePendingAction,
} from '../../components/ui';
import { useT } from '../../i18n';
import { space, Text } from '../../theme';
import { Pane } from './components/Pane';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { patientNumberDigits, patientNumberError } from './data/clinic';
import { errorText } from './data/errors';

const CLINIC_TYPES: readonly DropdownOption<ClinicType>[] = [
    { value: 'dental', label: 'Dental' },
    { value: 'general', label: 'General' },
];

export function ClinicScreen({ onBack }: { onBack: () => void }) {
    const t = useT();
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const clinic = useQuery(trpc.settings.get.queryOptions());
    const save = useMutation(
        trpc.settings.update.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries(trpc.settings.pathFilter()),
        }),
    );

    const [name, setName] = useState<string>();
    const [phone, setPhone] = useState<string>();
    const [patientNumber, setPatientNumber] = useState<string>();
    const [clinicType, setClinicType] = useState<ClinicType>();
    const [submitted, setSubmitted] = useState(false);
    const [toast, setToast] = useState(false);

    const data = clinic.data;
    const nameValue = name ?? data?.clinicName ?? '';
    const phoneValue = phone ?? data?.clinicPhone ?? '';
    const clinicTypeValue = clinicType ?? data?.clinicType ?? 'dental';
    const patientNumberValue = patientNumber ?? (data ? String(data.patientRefNext) : '');

    const nameError = submitted && nameValue.trim() === '' ? 'The clinic needs a name.' : undefined;
    const phoneError = submitted && phoneValue.trim() === '' ? 'The clinic needs a phone number.' : undefined;
    const patientNumberIssue = patientNumberError(patientNumberValue);

    const write = usePendingAction((job: () => Promise<unknown>) => job());

    function onSave() {
        setSubmitted(true);
        if (nameValue.trim() === '' || phoneValue.trim() === '') return;
        if (patientNumberIssue !== null) return;

        const patientRefNext = Number(patientNumberValue);

        write.run(async () => {
            await save.mutateAsync({
                clinicName: nameValue.trim(),
                clinicPhone: phoneValue.trim(),
                ...(patientRefNext !== data?.patientRefNext ? { patientRefNext } : {}),
                ...(clinicTypeValue !== data?.clinicType ? { clinicType: clinicTypeValue } : {}),
            });
            setName(undefined);
            setPhone(undefined);
            setPatientNumber(undefined);
            setClinicType(undefined);
            setSubmitted(false);
            setToast(true);
        });
    }

    return (
        <Pane
            title="Clinic"
            onBack={write.pending ? () => {} : onBack}
            testID="settings-clinic"
            overlay={<Toast visible={toast} message="Clinic saved" onDismiss={() => setToast(false)} />}
            footer={
                data ? (
                    <ActionBar
                        primaryLabel={write.pending ? 'Saving' : 'Save'}
                        onPrimary={onSave}
                        primaryLoading={write.pending}
                        testID="clinic-save"
                    />
                ) : undefined
            }
        >
            {clinic.isLoading ? <SkeletonRows count={3} /> : null}

            {clinic.error ? (
                <ErrorState
                    message={errorText(clinic.error)}
                    onRetry={clinic.refetch}
                    retrying={clinic.isFetching}
                />
            ) : null}

            {data ? (
                <>
                    {save.error ? (
                        <Callout tone="warning" title="Not saved">
                            {errorText(save.error)}
                        </Callout>
                    ) : null}

                    <SectionLabel inset={false}>CLINIC</SectionLabel>

                    <Card padded style={styles.form}>
                        <TextField
                            label="Clinic name"
                            required
                            value={nameValue}
                            onChangeText={setName}
                            placeholder="Nile Clinic"
                            error={nameError}
                            autoCapitalize="words"
                            testID="clinic-name"
                        />
                        <TextField
                            label="Phone"
                            required
                            value={phoneValue}
                            onChangeText={setPhone}
                            placeholder="0100 000 0000"
                            error={phoneError}
                            keyboardType="phone-pad"
                            testID="clinic-phone"
                        />
                    </Card>

                    <Text variant="footnote" tone="muted" style={styles.hint}>
                        {t('Appears on receipts and in reminder messages.')}
                    </Text>

                    <SectionLabel inset={false}>CLINIC TYPE</SectionLabel>

                    <Card padded style={styles.form}>
                        <DropdownField
                            options={CLINIC_TYPES}
                            value={clinicTypeValue}
                            onChange={setClinicType}
                            accessibilityLabel="Clinic type"
                            testID="clinic-type"
                        />
                    </Card>

                    <Text variant="footnote" tone="muted" style={styles.hint}>
                        {t(
                            clinicTypeValue === 'general'
                                ? 'Nothing asks for a tooth. Each procedure keeps its tooth setting, so choosing Dental again brings it back.'
                                : 'Procedures marked as done to a tooth ask which one.',
                        )}
                    </Text>

                    <SectionLabel inset={false}>PATIENT NUMBERS</SectionLabel>

                    <Card padded style={styles.form}>
                        <NumericField
                            label="Next patient number"
                            required
                            value={patientNumberValue}
                            onChangeText={(text) => setPatientNumber(patientNumberDigits(text))}
                            placeholder="1"
                            error={submitted ? (patientNumberIssue ?? undefined) : undefined}
                            keyboardType="number-pad"
                            size="body"
                            testID="clinic-patient-ref-next"
                        />
                    </Card>

                    <Text variant="footnote" tone="muted" style={styles.hint}>
                        {t(
                            'The next new patient registered gets this number, and the one after gets the number after it. A patient entered with an old number keeps that number instead, and does not use this one up.',
                        )}
                    </Text>
                </>
            ) : null}
        </Pane>
    );
}

const styles = StyleSheet.create({
    form: { gap: space[4] },
    hint: { paddingHorizontal: space[0.5] },
});
