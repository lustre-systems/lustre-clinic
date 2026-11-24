import { createContext, useContext } from 'react';

export const PaneVisibleContext = createContext(true);

export function usePaneVisible(): boolean {
    return useContext(PaneVisibleContext);
}
