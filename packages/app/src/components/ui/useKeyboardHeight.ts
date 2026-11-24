// biome-ignore lint/style/noRestrictedImports: subscribes to the native `Keyboard` show/hide events; React has no other way to hear the keyboard move
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useKeyboardHeight(): number {
    const [height, setHeight] = useState(0);
    const insets = useSafeAreaInsets();

    useEffect(() => {
        const showWill = Keyboard.addListener('keyboardWillShow', (event) =>
            setHeight(event.endCoordinates.height),
        );
        const showDid = Keyboard.addListener('keyboardDidShow', (event) =>
            setHeight(event.endCoordinates.height),
        );
        const hideWill = Keyboard.addListener('keyboardWillHide', () => setHeight(0));
        const hideDid = Keyboard.addListener('keyboardDidHide', () => setHeight(0));

        return () => {
            showWill.remove();
            showDid.remove();
            hideWill.remove();
            hideDid.remove();
        };
    }, []);

    if (height === 0 || Platform.OS !== 'android') return height;
    return height + insets.bottom;
}
