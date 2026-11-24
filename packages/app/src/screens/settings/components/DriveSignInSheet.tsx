import { StyleSheet, View } from 'react-native';
import { Button, Sheet } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, space, Text } from '../../../theme';
import { CheckIcon } from './icons';

export type DriveSignInSheetProps = {
    visible: boolean;
    account: string | null;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
};

const EFFECTS: readonly string[] = [
    'Google opens in a browser — sign in as the doctor, not as yourself',
    'Every backup from tonight goes to that account instead',
    'Older backups stay where they are; nothing is moved or deleted',
];

export function DriveSignInSheet({ visible, account, busy, onConfirm, onCancel }: DriveSignInSheetProps) {
    const t = useT();
    const relinking = account !== null;

    return (
        <Sheet
            visible={visible}
            onClose={onCancel}
            title={relinking ? 'Change the backup account?' : 'Link a Google account?'}
            subtitle="This decides where a copy of the whole clinic — every patient, visit and payment — is sent each night. Only do this if you were asked to."
            testID="settings-drive-sheet"
            footer={
                <>
                    <Button
                        label={
                            busy ? 'Opening Google…' : relinking ? 'Change account' : 'Sign in with Google'
                        }
                        onPress={onConfirm}
                        disabled={busy}
                        block
                        testID="settings-drive-confirm"
                    />
                    <Button label="Cancel" variant="ghost" onPress={onCancel} block />
                </>
            }
        >
            {relinking ? (
                <View style={styles.current}>
                    <Text variant="eyebrow" tone="muted">
                        {t('BACKING UP TO')}
                    </Text>
                    <Text variant="body" weight="semibold" style={styles.account}>
                        {account}
                    </Text>
                </View>
            ) : null}

            {EFFECTS.map((effect) => (
                <View key={effect} style={styles.effect}>
                    <CheckIcon size={15} />
                    <Text variant="subhead" tone="ink2" style={styles.effectText}>
                        {t(effect)}
                    </Text>
                </View>
            ))}
        </Sheet>
    );
}

const styles = StyleSheet.create({
    current: {
        padding: space[3.5],
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    account: { marginTop: space[1] },
    effect: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
    effectText: { flex: 1 },
});
