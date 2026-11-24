import { GLYPH, type IconProps, icon } from '../../../components/domain';
import { useIsRTL } from '../../../i18n';

export const PinIcon = icon(GLYPH.branch);

export const CalendarIcon = icon(GLYPH.day);

export const ClockIcon = icon(GLYPH.time);

export const ProcedureIcon = icon(GLYPH.procedure, { width: 1.8 });

const ArrowLeftIcon = icon(GLYPH.back, { width: 2.2 });

const ArrowRightIcon = icon(GLYPH.forward, { width: 2.2 });

export function ArrowBackIcon(props: IconProps) {
    return useIsRTL() ? <ArrowRightIcon {...props} /> : <ArrowLeftIcon {...props} />;
}

export function ArrowForwardIcon(props: IconProps) {
    return useIsRTL() ? <ArrowLeftIcon {...props} /> : <ArrowRightIcon {...props} />;
}

export const ChatIcon = icon(GLYPH.chat);

export const CloseIcon = icon(GLYPH.close, { width: 2.2 });

export const CheckIcon = icon(GLYPH.check, { width: 2.4 });

export const WaitingIcon = icon(GLYPH.waiting, { width: 2.2 });

export const DurationIcon = icon(GLYPH.duration);

export const PatientIcon = icon(GLYPH.patient);

export const LabIcon = icon(GLYPH.lab, { width: 2 });

export const ChairIcon = icon(GLYPH.procedure, { width: 2 });

export const PaymentIcon = icon(GLYPH.money, { width: 2.2 });

export const PlusIcon = icon(GLYPH.add, { width: 2.4 });

export const XIcon = icon(GLYPH.close, { width: 2.2 });

export const MoreIcon = icon(GLYPH.more, { width: 2.2 });

export const RetryIcon = icon(GLYPH.retry, { width: 2 });

export const TrashIcon = icon(GLYPH.delete, { width: 2 });

export const RescheduleIcon = icon(GLYPH.reschedule, { width: 2 });

export const NoShowIcon = icon(GLYPH.noShow, { width: 2 });

export const CancelAppointmentIcon = icon(GLYPH.cancelAppointment, { width: 2 });
