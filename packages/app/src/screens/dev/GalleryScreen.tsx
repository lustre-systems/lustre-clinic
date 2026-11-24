import type { ReactNode } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { GLYPH } from '../../components/domain';
import {
    ActionBar,
    AddButton,
    Banner,
    Button,
    Callout,
    Card,
    CardDivider,
    Chevron,
    Chip,
    ConfirmSheet,
    Dot,
    DropdownMenu,
    EmptyState,
    IconButton,
    InlineEditor,
    ListEditor,
    NumericField,
    PopoverMenu,
    ProgressBar,
    PushView,
    Radio,
    ScreenHeader,
    SearchField,
    SectionLabel,
    SegmentedControl,
    Select,
    Sheet,
    Stepper,
    Switch,
    Tag,
    Textarea,
    TextField,
    Toast,
    TopBar,
} from '../../components/ui';
import { color, size, space, Text } from '../../theme';

export function GalleryScreen() {
    const [toast, setToast] = useState<string | null>(null);

    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <ScreenHeader eyebrow="dev" title="Components" subtitle="ui/ — design system primitives" />

                <Buttons />
                <Pending />
                <SmallControls />
                <Selection />
                <Fields />
                <Editors />
                <Surfaces />
                <Feedback />
                <Overlays onToast={setToast} />
                <Chrome />
            </ScrollView>

            <Toast
                visible={toast !== null}
                message={toast ?? ''}
                actionLabel="Undo"
                onAction={noop}
                onDismiss={() => setToast(null)}
            />
        </View>
    );
}

function Buttons() {
    return (
        <Section title="Button">
            <Row>
                <Button label="Primary" onPress={noop} />
                <Button label="Accent" variant="accent" onPress={noop} />
                <Button label="Secondary" variant="secondary" onPress={noop} />
            </Row>
            <Row>
                <Button label="Ghost" variant="ghost" onPress={noop} />
                <Button label="Deactivate" variant="danger" onPress={noop} />
                <Button label="Text" variant="text" onPress={noop} />
            </Row>
            <Row>
                <Button label="Cancel it" variant="dangerText" onPress={noop} />
                <Button label="Medium" size="md" onPress={noop} />
                <Button label="Disabled" disabled onPress={noop} />
                <Button label="Loading" loading onPress={noop} />
            </Row>
            <Button label="Block" block onPress={noop} />
        </Section>
    );
}

function Pending() {
    const [saving, setSaving] = useState(false);
    const [presses, setPresses] = useState(0);

    function save() {
        setSaving(true);
        setPresses((count) => count + 1);
        setTimeout(() => setSaving(false), 1200);
    }

    return (
        <Section
            title="Pending state"
            note="Tap Book repeatedly during the spinner — the count must go up by one."
        >
            <Button label="Book appointment" loading={saving} onPress={save} block />
            <Text variant="subhead" tone="muted">
                {`Writes sent: ${presses}`}
            </Text>
        </Section>
    );
}

function SmallControls() {
    const [count, setCount] = useState(2);

    return (
        <Section title="Icon, add, stepper">
            <Row>
                <IconButton accessibilityLabel="More" icon={<Text variant="callout">⋯</Text>} />
                <IconButton
                    accessibilityLabel="WhatsApp"
                    variant="filled"
                    tone="wa"
                    icon={
                        <Text variant="callout" tone="inverse">
                            ✆
                        </Text>
                    }
                />
                <IconButton
                    accessibilityLabel="Previous day"
                    variant="square"
                    icon={<Chevron direction="back" />}
                />
                <IconButton
                    accessibilityLabel="Remove"
                    variant="bare"
                    icon={
                        <Text variant="callout" tone="muted">
                            ✕
                        </Text>
                    }
                />
                <Stepper value={count} onChange={setCount} min={0} max={9} accessibilityLabel="Quantity" />
            </Row>
            <AddButton label="Add option" />
            <AddButton label="Add to UL6" variant="footer" />
            <Row>
                <AddButton label="Add" variant="compact" />
            </Row>
        </Section>
    );
}

function Selection() {
    const [chip, setChip] = useState('half');
    const [segment, setSegment] = useState<'treatment' | 'payment'>('treatment');
    const [radio, setRadio] = useState('30');
    const [reminders, setReminders] = useState(true);

    return (
        <Section title="Selection">
            <SegmentedControl
                segments={[
                    { value: 'treatment', label: 'Treatment' },
                    { value: 'payment', label: 'Payment' },
                ]}
                value={segment}
                onChange={setSegment}
            />

            <Row>
                {['full', 'half', 'nothing'].map((value) => (
                    <Chip
                        key={value}
                        label={value}
                        selected={chip === value}
                        onPress={() => setChip(value)}
                        grow
                    />
                ))}
            </Row>
            <Row>
                <Chip label="New category" variant="new" />
                <Chip label="Disabled" disabled />
            </Row>

            <Row>
                <Radio selected={radio === '30'} label="30 min" onPress={() => setRadio('30')} />
                <Radio selected={radio === '45'} label="45 min" onPress={() => setRadio('45')} />
            </Row>

            <View style={styles.spread}>
                <Text variant="body">Send reminders</Text>
                <Switch value={reminders} onValueChange={setReminders} accessibilityLabel="Send reminders" />
            </View>
        </Section>
    );
}

function Fields() {
    const [name, setName] = useState('');
    const [arabic, setArabic] = useState('محمد عبد الله');
    const [amount, setAmount] = useState('700');
    const [minutes, setMinutes] = useState('30');
    const [notes, setNotes] = useState('');
    const [query, setQuery] = useState('');
    const [sex, setSex] = useState<'f' | 'm' | null>(null);

    return (
        <Section title="Fields">
            <TextField label="Full name" value={name} onChangeText={setName} placeholder="Patient name" />
            <TextField
                label="Arabic label"
                value={arabic}
                onChangeText={setArabic}
                hint="The face follows the string, not the screen."
            />
            <TextField
                label="Phone"
                value=""
                onChangeText={noop}
                placeholder="01x xxxx xxxx"
                error="Required"
                required
            />
            <NumericField
                label="Amount paid"
                variant="display"
                prefix="EGP"
                value={amount}
                onChangeText={setAmount}
            />
            <NumericField label="Duration" suffix="min" value={minutes} onChangeText={setMinutes} />
            <Textarea
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything worth remembering"
            />
            <SearchField value={query} onChangeText={setQuery} placeholder="Search patients" />
            <Select
                label="Sex"
                options={[
                    { value: 'f', label: 'Female' },
                    { value: 'm', label: 'Male' },
                ]}
                value={sex}
                onChange={setSex}
                placeholder="Not answered"
            />
        </Section>
    );
}

function Editors() {
    const [price, setPrice] = useState('700');
    const [options, setOptions] = useState<string[]>(['Yes', 'No']);

    return (
        <Section title="Editors">
            <View style={styles.spread}>
                <Text variant="body">Composite filling</Text>
                <InlineEditor value={price} onCommit={setPrice} variant="amount" keyboardType="decimal-pad" />
            </View>
            <ListEditor items={options} onChange={setOptions} />
        </Section>
    );
}

function Surfaces() {
    return (
        <Section title="Surfaces">
            <SectionLabel count={3} inset={false}>
                Today
            </SectionLabel>

            <Card>
                <View style={styles.cardRow}>
                    <Text variant="headline">Root canal</Text>
                    <Text variant="amount" tone="due">
                        2,600
                    </Text>
                </View>
                <CardDivider />
                <View style={styles.cardRow}>
                    <Text variant="body" tone="ink2">
                        Zirconia crown
                    </Text>
                    <Chevron />
                </View>
            </Card>

            <Card variant="dashed" padded>
                <Text variant="subhead" tone="muted">
                    Built in — cannot be renamed or removed.
                </Text>
            </Card>

            <Row>
                <Tag tone="danger">Required</Tag>
                <Tag tone="accent" variant="filled">
                    Checkup
                </Tag>
                <Tag variant="muted">Inactive</Tag>
            </Row>

            <Row>
                <Dot tone="live" pulse size={8} />
                <Dot tone="wa" pulse />
                <Dot tone="due" />
                <Dot tone="muted" />
            </Row>

            <ProgressBar value={0.62} accessibilityLabel="Collection rate" />
            <ProgressBar value={0.28} tone="due" height={5} />
        </Section>
    );
}

function Feedback() {
    return (
        <Section title="Feedback">
            <Callout tone="info">Visits already recorded stay at 700 EGP.</Callout>
            <Callout tone="warning" title="This day is full">
                Booking here will overrun the clinic's closing time.
            </Callout>
            <Callout tone="reassurance">Answers are kept, not erased.</Callout>
            <Callout tone="note">Built-in details cannot be reordered.</Callout>

            <Banner
                tone="offline"
                message="Not connected to the clinic"
                live
                action={<Button label="Retry" variant="text" size="md" onPress={noop} />}
            />
            <Banner tone="warning" message="Showing data from 12 minutes ago" />

            <EmptyState
                icon={<GLYPH.add size={22} color={color.ink2} strokeWidth={2.2} />}
                title="No procedures yet"
                body="Add the first one and it will show up here."
                actionLabel="Add procedure"
                onAction={() => undefined}
                weight="panel"
            />
            <EmptyState
                icon={<GLYPH.day size={22} color={color.ink2} strokeWidth={2} />}
                title="Nothing in the chair"
                body="The next patient is at 14:30."
            />
            <EmptyState title="No one owes anything" weight="line" />
        </Section>
    );
}

function Overlays({ onToast }: { onToast: (message: string) => void }) {
    const [sheet, setSheet] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [popover, setPopover] = useState(false);
    const [dropdown, setDropdown] = useState(false);
    const [sort, setSort] = useState<'amount' | 'age'>('amount');
    const [note, setNote] = useState('');

    function confirmDeactivate() {
        setConfirming(true);
        setTimeout(() => {
            setConfirming(false);
            setConfirm(false);
            onToast('Procedure deactivated');
        }, 1200);
    }

    return (
        <Section
            title="Overlays"
            note="Open the sheet and focus a field — the footer must stay above the keyboard."
        >
            <Row>
                <Button label="Sheet" variant="ghost" size="md" onPress={() => setSheet(true)} />
                <Button label="Confirm" variant="ghost" size="md" onPress={() => setConfirm(true)} />
                <Button label="Popover" variant="ghost" size="md" onPress={() => setPopover(true)} />
                <Button label="Dropdown" variant="ghost" size="md" onPress={() => setDropdown(true)} />
                <Button label="Toast" variant="ghost" size="md" onPress={() => onToast('Visit deleted')} />
            </Row>

            <Sheet
                visible={sheet}
                onClose={() => setSheet(false)}
                title="Add a note"
                subtitle="Half the sheets in this app hold an input"
                footer={<Button label="Save" onPress={() => setSheet(false)} block />}
            >
                <TextField
                    label="Note"
                    value={note}
                    onChangeText={setNote}
                    placeholder="Type here"
                    autoFocus
                />
                <Textarea
                    label="Longer note"
                    value=""
                    onChangeText={noop}
                    placeholder="Scroll me with the keyboard up"
                />
                <TextField label="Another field" value="" onChangeText={noop} placeholder="And another" />
                <TextField label="And another" value="" onChangeText={noop} placeholder="Keeps going" />
                <TextField label="Last one" value="" onChangeText={noop} placeholder="Reachable?" />
            </Sheet>

            <ConfirmSheet
                visible={confirm}
                title="Deactivate this procedure?"
                body="It stops being offered on new visits."
                detail={
                    <Callout tone="reassurance">Past visits keep it, and their prices do not change.</Callout>
                }
                confirmLabel="Deactivate"
                onConfirm={confirmDeactivate}
                onCancel={() => setConfirm(false)}
                destructive
                loading={confirming}
            />

            <PopoverMenu
                visible={popover}
                onClose={() => setPopover(false)}
                anchor={{ top: space[12] }}
                items={[
                    { key: 'edit', label: 'Edit visit', onPress: noop },
                    { key: 'move', label: 'Move to another day', onPress: noop },
                    {
                        key: 'delete',
                        label: 'Delete visit',
                        onPress: () => onToast('Visit deleted'),
                        danger: true,
                    },
                ]}
            />

            <DropdownMenu
                visible={dropdown}
                onClose={() => setDropdown(false)}
                anchor={{ top: space[12] }}
                options={[
                    { value: 'amount', label: 'Largest first' },
                    { value: 'age', label: 'Oldest first' },
                ]}
                value={sort}
                onChange={setSort}
            />
        </Section>
    );
}

function Chrome() {
    const [pushed, setPushed] = useState(false);

    return (
        <Section title="Chrome">
            <View style={styles.frame}>
                <TopBar
                    title="Procedures & prices"
                    onBack={noop}
                    trailing={<Button label="Reorder" variant="text" size="md" onPress={noop} />}
                />
                <View style={styles.framedBody}>
                    <Text variant="subhead" tone="muted">
                        List
                    </Text>
                    <Button label="Open form" variant="ghost" size="md" onPress={() => setPushed(true)} />

                    <PushView visible={pushed}>
                        <View style={styles.pushed}>
                            <TopBar title="Composite filling" onBack={() => setPushed(false)} />
                            <View style={styles.framedBody}>
                                <Text variant="subhead" tone="muted">
                                    Form — slides in from the inline edge, mirrors in Arabic.
                                </Text>
                            </View>
                        </View>
                    </PushView>
                </View>
                <ActionBar primaryLabel="Save" onPrimary={noop} secondaryLabel="Cancel" onSecondary={noop} />
            </View>
        </Section>
    );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
    return (
        <View style={styles.section}>
            <SectionLabel inset={false}>{title}</SectionLabel>
            {note ? (
                <Text variant="footnote" tone="muted">
                    {note}
                </Text>
            ) : null}
            {children}
        </View>
    );
}

function Row({ children }: { children: ReactNode }) {
    return <View style={styles.row}>{children}</View>;
}

function noop() {}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    content: { paddingBottom: space[12] },
    section: {
        gap: space[3],
        paddingHorizontal: size.gutter,
        paddingVertical: space[5],
        borderTopWidth: 1,
        borderTopColor: color.line,
    },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
    spread: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: size.row,
    },
    cardRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: size.row,
        padding: space[4],
    },
    frame: {
        height: 320,
        borderRadius: space[4],
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.canvas,
        overflow: 'hidden',
    },
    framedBody: { flex: 1, gap: space[3], padding: size.gutter },
    pushed: { flex: 1, backgroundColor: color.canvas },
});
