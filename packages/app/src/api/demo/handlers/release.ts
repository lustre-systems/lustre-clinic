import type { RouterOutput } from '../../types';
import type { Dated } from '../wire';

export const releaseHandlers = {
    latestApk(): Dated<RouterOutput['release']['latestApk']> {
        return null;
    },
};
