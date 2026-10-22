// "Last done": what this phone wrote, kept on the phone. The log is filled by
// `link.ts`, which the API client mounts; screens only draw it.
export type { LastDoneTarget } from './entry';
export { LastDoneButton } from './LastDoneButton';
export { LastDoneSheet } from './LastDoneSheet';
export { lastDone } from './store';
