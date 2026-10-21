/**
 * The app's one icon set: every `lucide-react-native` glyph is picked here,
 * once per concept, and lint refuses the library anywhere else. The clusters'
 * `icons.tsx` files still name icons after the job they do on their screens and
 * set their own sizes and weights, but they build them from `GLYPH`, so "add"
 * is the same plus and "procedure" the same stethoscope on every screen.
 *
 * `ui/` cannot import this — it knows nothing of the library — so a primitive
 * that shows an icon takes it as a prop.
 */
import type { PaymentMethod } from '@lustre/shared';
import {
    AppWindow,
    ArrowLeft,
    ArrowRight,
    Banknote,
    Bell,
    Calendar,
    CalendarClock,
    CalendarDays,
    CalendarPlus,
    CalendarX,
    ChartNoAxesColumn,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    CloudAlert,
    CloudOff,
    CreditCard,
    DatabaseBackup,
    Ellipsis,
    EyeOff,
    FlaskConical,
    Folder,
    Headset,
    History,
    Hospital,
    Hourglass,
    Info,
    Landmark,
    ListPlus,
    LogIn,
    LogOut,
    MapPin,
    MessageCircle,
    MessageSquareWarning,
    Pencil,
    Phone,
    Plus,
    Power,
    QrCode,
    Receipt,
    RefreshCw,
    RotateCcw,
    ScanQrCode,
    Search,
    ShieldCheck,
    Stethoscope,
    Tags,
    Timer,
    Trash2,
    TriangleAlert,
    User,
    Users,
    UserX,
    X,
    Zap,
    // biome-ignore lint/style/noRestrictedImports: this file is the one place the library is imported
} from 'lucide-react-native';
import { color } from '../../theme';

export type IconProps = {
    size?: number;
    stroke?: string;
    width?: number;
};

export type Glyph = typeof Search;

export const GLYPH = {
    add: Plus,
    app: AppWindow,
    appointments: CalendarDays,
    back: ArrowLeft,
    bank: Landmark,
    book: CalendarPlus,
    branch: MapPin,
    call: Phone,
    cancelAppointment: CalendarX,
    caretDown: ChevronDown,
    category: Folder,
    chat: MessageCircle,
    check: Check,
    chevronBack: ChevronLeft,
    chevronForward: ChevronRight,
    clinic: Hospital,
    close: X,
    day: Calendar,
    deactivate: Power,
    delete: Trash2,
    desk: Headset,
    driveAlert: CloudAlert,
    duration: Timer,
    edit: Pencil,
    enterDemo: LogIn,
    fields: ListPlus,
    forward: ArrowRight,
    hide: EyeOff,
    info: Info,
    lab: FlaskConical,
    leaveDemo: LogOut,
    backups: DatabaseBackup,
    money: CreditCard,
    more: Ellipsis,
    noShow: UserX,
    offline: CloudOff,
    oldVisit: History,
    pay: Banknote,
    patient: User,
    patients: Users,
    problem: TriangleAlert,
    procedure: Stethoscope,
    procedures: Tags,
    reminders: Bell,
    reportProblem: MessageSquareWarning,
    reprobe: RefreshCw,
    reschedule: CalendarClock,
    roles: ShieldCheck,
    scanCode: ScanQrCode,
    showCode: QrCode,
    resetDemo: RotateCcw,
    retry: RefreshCw,
    search: Search,
    stats: ChartNoAxesColumn,
    time: Clock,
    waiting: Hourglass,
} satisfies Record<string, Glyph>;

/** The four ways the clinic is paid, drawn the same wherever a method shows. */
export const METHOD_GLYPH: Record<PaymentMethod, Glyph> = {
    cash: Banknote,
    visa: CreditCard,
    instapay: Zap,
    other: Receipt,
};

export function icon(Glyph: Glyph, defaults: IconProps = {}) {
    const { size: dSize = 15, stroke: dStroke = color.muted, width: dWidth = 2 } = defaults;
    return function Wrapped({ size = dSize, stroke = dStroke, width = dWidth }: IconProps) {
        return <Glyph size={size} color={stroke} strokeWidth={width} />;
    };
}

export function MethodIcon({
    method,
    size = 18,
    stroke = color.muted,
    width = 1.8,
}: IconProps & { method: PaymentMethod }) {
    const Glyph = METHOD_GLYPH[method];
    return <Glyph size={size} color={stroke} strokeWidth={width} />;
}
