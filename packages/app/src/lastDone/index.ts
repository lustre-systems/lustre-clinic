// "Last done": what this phone wrote, kept on the phone. The log is filled by
// `link.ts`, which the API client mounts; the day view's Done tab draws it.
export type { LastDoneTarget } from './entry';
export { LastDoneList } from './LastDoneList';
export { hasUnseen, lastDone, todayCount } from './store';
