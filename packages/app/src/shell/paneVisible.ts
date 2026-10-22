import { createContext, useContext } from 'react';

/**
 * Whether the tab a screen is mounted in is the one on screen. The shell keeps
 * every visited tab mounted and hides the rest, so a screen cannot tell from
 * mounting that its tab has just been opened; this turning true is that moment.
 * Outside a tab pane — a gallery, a test — a screen counts as on screen.
 */
export const PaneVisibleContext = createContext(true);

export function usePaneVisible(): boolean {
    return useContext(PaneVisibleContext);
}
