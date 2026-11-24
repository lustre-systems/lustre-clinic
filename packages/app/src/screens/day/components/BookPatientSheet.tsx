import { useState } from 'react';
import { Button, Sheet } from '../../../components/ui';
import { EMPTY_PATIENT_DRAFT, type PatientDraft, patientRefOf } from '../patientDraft';
import { PatientPicker } from './PatientPicker';

export type BookPatientSheetProps = {
    visible: boolean;
    onClose: () => void;
    onPicked: (draft: PatientDraft) => void;
    onRegisterNew: () => void;
};

export function BookPatientSheet({ visible, onClose, onPicked, onRegisterNew }: BookPatientSheetProps) {
    const [draft, setDraft] = useState<PatientDraft>(EMPTY_PATIENT_DRAFT);

    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title="Who is it for?"
            testID="book-patient-sheet"
            footer={
                <Button
                    label="Continue"
                    block
                    disabled={patientRefOf(draft) === null}
                    onPress={() => onPicked(draft)}
                    testID="book-continue"
                />
            }
        >
            <PatientPicker value={draft} onChange={setDraft} active={visible} onRegisterNew={onRegisterNew} />
        </Sheet>
    );
}
