export type FinishPress = 'ask' | 'finish' | 'ignore';

export function finishPress(askToEdit: boolean | undefined, busy: boolean): FinishPress {
    if (busy) return 'ignore';
    return askToEdit === false ? 'finish' : 'ask';
}
