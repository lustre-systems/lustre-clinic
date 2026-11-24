import { Button, Sheet } from '../../../components/ui';

export type FinishSheetProps = {
    visible: boolean;
    patientName: string;
    loading: boolean;
    onEdit: () => void;
    onFinish: () => void;
    onClose: () => void;
    onClosed: () => void;
};

export function FinishSheet({
    visible,
    patientName,
    loading,
    onEdit,
    onFinish,
    onClose,
    onClosed,
}: FinishSheetProps) {
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            onClosed={onClosed}
            dismissable={!loading}
            title="Edit the procedures first?"
            subtitle={patientName}
            testID="finish-sheet"
            footer={
                <>
                    <Button
                        label="Edit procedures"
                        block
                        loading={loading}
                        onPress={onEdit}
                        testID="finish-edit"
                    />
                    <Button
                        label="Finish without editing"
                        variant="text"
                        block
                        disabled={loading}
                        onPress={onFinish}
                        testID="finish-skip"
                    />
                </>
            }
        />
    );
}
