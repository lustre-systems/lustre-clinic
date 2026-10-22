// `domain/` knows what a patient, a visit and a balance are. It composes `ui/`
// and adds product meaning (Component Inventory §2). The barrel is the only
// entry point: screens import from `components/domain`, never from a file.
//
// `patientDraft` and `money` are the exceptions, and are imported by their own
// paths. They are rules rather than markup, they are covered by `bun test`, and
// every component below imports `react-native` — which fails outside Metro, so a
// barrel that re-exported them would drag React Native into suites that have no
// renderer and do not need one. `formatMoney` and `formatAmount` are re-exported
// here anyway in their direction-aware form, which does need React Native; that
// pair is what a screen should reach for.

export type { BottomTabBarProps, TabKey } from './BottomTabBar';
export { BottomTabBar, showsStats } from './BottomTabBar';
export type { BrandMarkProps } from './BrandMark';
export { BrandMark } from './BrandMark';
export type { Clock12 } from './clock';
export {
    clock12,
    DAY_MINUTES,
    formatClock12,
    formatSpan,
    formatStamp,
    formatTime12,
    minutesOfDay,
    time12,
} from './clock';
export type { Glyph, IconProps } from './icons';
export { GLYPH, icon, MethodIcon } from './icons';
export type { MoneyValueProps } from './MoneyValue';
export { formatMoney, MoneyValue } from './MoneyValue';
export type { PatientRowProps, PatientSummary } from './PatientRow';
export { PatientRow } from './PatientRow';
export { phoneText } from './phone';
export type { StatusBadgeProps } from './StatusBadge';
export { StatusBadge } from './StatusBadge';
export type { StatusPillProps, StatusTone } from './StatusPill';
export { StatusPill, statusCopy, statusLabel, statusTone } from './StatusPill';
export type { BadgeTone } from './status';
export { badgeTone } from './status';
export type { TimeValueProps } from './TimeValue';
export { TimeValue } from './TimeValue';
export type { ToothGroupCardProps, ToothGroupLine } from './ToothGroupCard';
export { ToothGroupCard } from './ToothGroupCard';
