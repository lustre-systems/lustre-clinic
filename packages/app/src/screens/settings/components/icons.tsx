import { FontAwesome } from '@expo/vector-icons';
import { GLYPH, type IconProps, icon } from '../../../components/domain';
import { useIsRTL } from '../../../i18n';
import { color } from '../../../theme';

export type { IconProps };

const ROW: Required<IconProps> = { size: 16, stroke: color.ink, width: 1.8 };

const ROW_ICON = {
    app: icon(GLYPH.app, ROW),
    appointments: icon(GLYPH.appointments, ROW),
    reminders: icon(GLYPH.reminders, ROW),
    clinic: icon(GLYPH.clinic, ROW),
    branches: icon(GLYPH.branch, ROW),
    procedures: icon(GLYPH.procedures, ROW),
    fields: icon(GLYPH.fields, ROW),
    about: icon(GLYPH.info, ROW),
    hours: icon(GLYPH.time, ROW),
    backups: icon(GLYPH.backups, ROW),
    roles: icon(GLYPH.roles, ROW),
} as const;

export type SettingsGlyph = keyof typeof ROW_ICON;

export type SettingsIconProps = IconProps & {
    glyph: SettingsGlyph;
};

export function SettingsIcon({ glyph, ...rest }: SettingsIconProps) {
    const Glyph = ROW_ICON[glyph];
    return <Glyph {...rest} />;
}

export const DriveAlertIcon = icon(GLYPH.driveAlert, { size: 18, stroke: color.dueText, width: 2 });

export const ScanCodeIcon = icon(GLYPH.scanCode, { size: 16, stroke: color.inverse, width: 2 });

export const ReprobeIcon = icon(GLYPH.reprobe, { size: 14, stroke: color.ink, width: 2.2 });

export const PlusIcon = icon(GLYPH.add, { size: 14, stroke: color.inverse, width: 2.6 });

export const CloseIcon = icon(GLYPH.close, { size: 15, stroke: color.muted, width: 2.2 });

export const CheckIcon = icon(GLYPH.check, { size: 15, stroke: color.muted, width: 2.4 });

export const InfoIcon = icon(GLYPH.info, { size: 16, stroke: color.muted, width: 2 });

export const PowerIcon = icon(GLYPH.deactivate, { size: 15, stroke: color.ink, width: 2.2 });

export const ResetDemoIcon = icon(GLYPH.resetDemo, ROW);

export const LeaveDemoIcon = icon(GLYPH.leaveDemo, ROW);

export const EnterDemoIcon = icon(GLYPH.enterDemo, ROW);

export const ReportProblemIcon = icon(GLYPH.reportProblem, ROW);

export const HideIcon = icon(GLYPH.hide, { size: 15, stroke: color.ink, width: 2.2 });

export const EditIcon = icon(GLYPH.edit, { size: 15, stroke: color.muted, width: 2 });

export const CategoryIcon = icon(GLYPH.category, { size: 15, stroke: color.muted, width: 2 });

export function WhatsAppIcon({ size = 15, stroke = color.wa }: Omit<IconProps, 'width'>) {
    return <FontAwesome name="whatsapp" size={size} color={stroke} />;
}

const ArrowForward = icon(GLYPH.forward, { size: 18, stroke: color.muted, width: 2.2 });
const ArrowBack = icon(GLYPH.back, { size: 18, stroke: color.muted, width: 2.2 });

export function ArrowRightIcon(props: IconProps) {
    return useIsRTL() ? <ArrowBack {...props} /> : <ArrowForward {...props} />;
}

const ChevronBack = icon(GLYPH.chevronBack, { size: 15, stroke: color.ink, width: 2.4 });
const ChevronForward = icon(GLYPH.chevronForward, { size: 15, stroke: color.ink, width: 2.4 });

export function BackIcon(props: IconProps) {
    return useIsRTL() ? <ChevronForward {...props} /> : <ChevronBack {...props} />;
}
