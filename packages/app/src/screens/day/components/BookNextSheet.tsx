import { Button, Sheet } from '../../../components/ui';

export type BookNextSheetProps = {
    visible: boolean;
    patientName: string;
    onBookNow: () => void;
    onLater: () => void;
    onClosed: () => void;
};

export function BookNextSheet({ visible, patientName, onBookNow, onLater, onClosed }: BookNextSheetProps) {
    return (
        <Sheet
            visible={visible}
            onClose={onLater}
            onClosed={onClosed}
            title="Book their next visit?"
            subtitle={patientName}
            testID="book-next-sheet"
            footer={
                <>
                    <Button label="Book next now" block onPress={onBookNow} testID="book-next-now" />
                    <Button
                        label="Book later"
                        variant="text"
                        block
                        onPress={onLater}
                        testID="book-next-dismiss"
                    />
                </>
            }
        />
    );
}
