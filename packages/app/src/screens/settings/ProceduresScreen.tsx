import { MAX_PROCEDURE_NAME, seesStats } from '@lustre/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { type RouterOutput, useTRPC } from '../../api';
import { MoneyValue } from '../../components/domain';
import { poundsToPiastres, sanitisePounds } from '../../components/domain/money';
import {
    ActionBar,
    AddButton,
    Button,
    Callout,
    Card,
    CardDivider,
    Chevron,
    ConfirmSheet,
    EmptyState,
    IconButton,
    NumericField,
    PushView,
    ReorderControls,
    SectionLabel,
    Select,
    Sheet,
    Switch,
    Tag,
    TextField,
    Toast,
    usePendingAction,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { isOpen, rendered, useRouteStack } from '../../navigation';
import { useBackHandler } from '../../shell/useBackHandler';
import { useRole } from '../../shell/useRole';
import { color, radius, size, space, Text } from '../../theme';

import { CategoryIcon, EditIcon, HideIcon, PlusIcon } from './components/icons';
import { Pane } from './components/Pane';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { errorText } from './data/errors';

type ProcedureNode = RouterOutput['procedure']['tree'][number];
type Procedure = ProcedureNode['children'][number];

type EditorRoute =
    | { kind: 'edit'; procedure: Procedure }
    | { kind: 'new' }
    | { kind: 'under'; parent: ProcedureNode }
    | { kind: 'category'; name: string };

export function ProceduresScreen({ onBack }: { onBack: () => void }) {
    const t = useT();
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const tree = useQuery(trpc.procedure.tree.queryOptions({ includeInactive: true }));
    const settings = useQuery(trpc.settings.get.queryOptions());
    const general = settings.data?.clinicType === 'general';
    const [namingCategory, setNamingCategory] = useState(false);
    const [reordering, setReordering] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    useBackHandler(() => {
        if (!reordering) return false;
        setReordering(false);
        return true;
    });

    const editor = useRouteStack<EditorRoute>();

    const reorder = useMutation(
        trpc.procedure.reorder.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries(trpc.procedure.pathFilter()),
        }),
    );

    const moveRow = usePendingAction((input: Parameters<typeof reorder.mutateAsync>[0]) =>
        reorder.mutateAsync(input),
    );

    function move(siblings: readonly { id: string }[], index: number, delta: number) {
        const next = [...siblings];
        const moved = next[index];
        const target = next[index + delta];
        if (!moved || !target) return;
        next[index] = target;
        next[index + delta] = moved;
        moveRow.run({ ids: next.map((row) => row.id) });
    }

    const all = tree.data ?? [];

    function nextSortOrder(parentId: string | null): number {
        if (parentId === null) return all.length;
        return all.find((node) => node.id === parentId)?.children.length ?? 0;
    }

    const nodes = all
        .filter((node) => node.active)
        .map((node) => ({ ...node, children: node.children.filter((child) => child.active) }));

    const empty = nodes.length === 0;

    const pull = usePullToRefresh(() => {
        if (!reordering) void tree.refetch();
    }, tree.isFetching);

    return (
        <>
            <Pane
                title="Procedures & prices"
                onBack={reordering ? () => setReordering(false) : onBack}
                pull={pull}
                trailing={
                    empty ? null : (
                        <Button
                            label={reordering ? 'Done' : 'Reorder'}
                            variant="text"
                            size="md"
                            onPress={() => setReordering((on) => !on)}
                        />
                    )
                }
                overlay={
                    <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
                }
            >
                {tree.isLoading ? <SkeletonRows count={4} trailing /> : null}

                {tree.error ? (
                    <ErrorState
                        message={errorText(tree.error)}
                        onRetry={tree.refetch}
                        retrying={tree.isFetching}
                    />
                ) : null}

                {reorder.error ? (
                    <Callout tone="warning" title="Order not saved">
                        {errorText(reorder.error)}
                    </Callout>
                ) : null}

                {tree.data && empty ? (
                    <EmptyState
                        weight="panel"
                        icon={<PlusIcon size={22} stroke={color.ink2} width={2.2} />}
                        title="No procedures yet"
                        body="These are what a visit is charged for. Add the checkup first — it is the line every visit starts with."
                        actionLabel="Add a procedure"
                        onAction={() => editor.push({ kind: 'new' })}
                    />
                ) : null}

                {nodes.map((node, index) =>
                    node.selectable ? (
                        <Card key={node.id}>
                            <ProcedureRow
                                procedure={node}
                                reordering={reordering}
                                reorderDisabled={moveRow.pending}
                                general={general}
                                isFirst={index === 0}
                                isLast={index === nodes.length - 1}
                                onPress={() => editor.push({ kind: 'edit', procedure: node })}
                                onMoveUp={() => move(nodes, index, -1)}
                                onMoveDown={() => move(nodes, index, 1)}
                            />
                        </Card>
                    ) : (
                        <View key={node.id} style={styles.category}>
                            <SectionLabel
                                inset={false}
                                count={node.children.length}
                                action={
                                    reordering ? (
                                        <ReorderControls
                                            itemLabel={node.name}
                                            isFirst={index === 0}
                                            isLast={index === nodes.length - 1}
                                            onMoveUp={() => move(nodes, index, -1)}
                                            onMoveDown={() => move(nodes, index, 1)}
                                        />
                                    ) : (
                                        <IconButton
                                            accessibilityLabel={t('Rename {name}', { name: node.name })}
                                            variant="bare"
                                            icon={<EditIcon size={15} />}
                                            onPress={() => editor.push({ kind: 'edit', procedure: node })}
                                            testID={`category-rename-${node.id}`}
                                        />
                                    )
                                }
                            >
                                {node.name.toUpperCase()}
                            </SectionLabel>

                            <Card>
                                {node.children.map((child, childIndex) => (
                                    <View key={child.id}>
                                        {childIndex > 0 ? <CardDivider /> : null}
                                        <ProcedureRow
                                            procedure={child}
                                            reordering={reordering}
                                            reorderDisabled={moveRow.pending}
                                            general={general}
                                            isFirst={childIndex === 0}
                                            isLast={childIndex === node.children.length - 1}
                                            onPress={() => editor.push({ kind: 'edit', procedure: child })}
                                            onMoveUp={() => move(node.children, childIndex, -1)}
                                            onMoveDown={() => move(node.children, childIndex, 1)}
                                        />
                                    </View>
                                ))}

                                {reordering ? null : (
                                    <>
                                        {node.children.length > 0 ? <CardDivider /> : null}
                                        <AddButton
                                            variant="footer"
                                            label={t('Add to {name}', { name: node.name })}
                                            onPress={() => editor.push({ kind: 'under', parent: node })}
                                        />
                                    </>
                                )}
                            </Card>
                        </View>
                    ),
                )}

                {tree.data && !reordering ? (
                    <View style={[styles.addRow, empty && styles.addRowAlone]}>
                        {empty ? null : (
                            <View style={styles.addProcedure}>
                                <AddButton
                                    label="Add a procedure"
                                    onPress={() => editor.push({ kind: 'new' })}
                                    testID="procedure-add"
                                />
                            </View>
                        )}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Add a category"
                            onPress={() => setNamingCategory(true)}
                            testID="category-add"
                            style={({ pressed }) => [styles.addCategory, pressed && styles.pressed]}
                        >
                            <CategoryIcon />
                            <Text variant="callout" weight="medium" tone="muted">
                                {t('Category')}
                            </Text>
                        </Pressable>
                    </View>
                ) : null}

                {namingCategory ? (
                    <CategorySheet
                        onClose={() => setNamingCategory(false)}
                        onNamed={(name) => {
                            setNamingCategory(false);
                            editor.push({ kind: 'category', name });
                        }}
                    />
                ) : null}
            </Pane>

            {rendered(editor.stack).map(({ id, route }, index) => (
                <PushView key={id} visible={isOpen(editor.stack, index)} onClosed={editor.settled}>
                    <ProcedureEditor
                        procedure={route.kind === 'edit' ? route.procedure : null}
                        parent={route.kind === 'under' ? route.parent : null}
                        newCategory={route.kind === 'category' ? route.name : null}
                        categories={all.filter((node) => !node.selectable)}
                        nextSortOrder={nextSortOrder}
                        general={general}
                        onClose={editor.pop}
                        onSaved={(message) => {
                            editor.pop();
                            setToast(message);
                        }}
                    />
                </PushView>
            ))}
        </>
    );
}

function CategorySheet({ onClose, onNamed }: { onClose: () => void; onNamed: (name: string) => void }) {
    const [name, setName] = useState('');
    const [submitted, setSubmitted] = useState(false);

    const error = submitted && name.trim() === '' ? 'A category needs a name.' : undefined;

    function onNext() {
        setSubmitted(true);
        if (name.trim() === '') return;
        onNamed(name.trim());
    }

    return (
        <Sheet
            visible
            onClose={onClose}
            title="New category"
            subtitle="A category groups procedures. It has no price of its own and can't be picked on a visit."
            testID="category-sheet"
            footer={
                <View style={styles.sheetActions}>
                    <View style={styles.sheetCancel}>
                        <Button label="Cancel" variant="ghost" onPress={onClose} block />
                    </View>
                    <View style={styles.sheetConfirm}>
                        <Button label="Next" onPress={onNext} block testID="category-next" />
                    </View>
                </View>
            }
        >
            <TextField
                value={name}
                onChangeText={setName}
                placeholder="Crowns"
                accessibilityLabel="Category name"
                maxLength={MAX_PROCEDURE_NAME}
                autoCapitalize="words"
                error={error}
                hint="The next screen asks for the first procedure under it."
                testID="category-name"
            />
        </Sheet>
    );
}

type ProcedureRowProps = {
    procedure: Procedure;
    reordering: boolean;
    reorderDisabled: boolean;
    general: boolean;
    isFirst: boolean;
    isLast: boolean;
    onPress: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
};

function ProcedureRow({
    procedure,
    reordering,
    reorderDisabled,
    general,
    isFirst,
    isLast,
    onPress,
    onMoveUp,
    onMoveDown,
}: ProcedureRowProps) {
    const body = (
        <View style={styles.rowText}>
            <Text variant="body" weight="medium">
                {procedure.name}
            </Text>
            <View style={styles.tags}>
                {procedure.isCheckup ? (
                    <Tag tone="accent" variant="filled">
                        WAIVED
                    </Tag>
                ) : null}
                {procedure.isToothSpecific && !general ? <Tag tone="muted">TOOTH</Tag> : null}
                {procedure.hasQuantity ? <Tag tone="muted">QTY</Tag> : null}
            </View>
        </View>
    );

    if (reordering) {
        return (
            <View style={styles.row}>
                {body}
                <ReorderControls
                    itemLabel={procedure.name}
                    isFirst={isFirst || reorderDisabled}
                    isLast={isLast || reorderDisabled}
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                />
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={procedure.name}
            onPress={onPress}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
            {body}
            <MoneyValue piastres={procedure.defaultPrice} />
            <Chevron direction="forward" tone="muted" />
        </Pressable>
    );
}

type ProcedureEditorProps = {
    procedure: Procedure | null;
    parent: ProcedureNode | null;
    newCategory: string | null;
    categories: ProcedureNode[];
    nextSortOrder: (parentId: string | null) => number;
    general: boolean;
    onClose: () => void;
    onSaved: (message: string) => void;
};

const NO_CATEGORY = 'none';

function ProcedureEditor({
    procedure,
    parent,
    newCategory,
    categories,
    nextSortOrder,
    general,
    onClose,
    onSaved,
}: ProcedureEditorProps) {
    const t = useT();
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const onProcedureWritten = () => queryClient.invalidateQueries(trpc.procedure.pathFilter());

    const [name, setName] = useState(procedure?.name ?? '');
    const [price, setPrice] = useState(procedure ? String(Math.round(procedure.defaultPrice / 100)) : '');
    const showsCost = seesStats(useRole().granted);
    const [cost, setCost] = useState(procedure?.cost ? String(Math.round(procedure.cost / 100)) : '');
    const [parentId, setParentId] = useState<string>(procedure?.parentId ?? parent?.id ?? NO_CATEGORY);
    const [toothSpecific, setToothSpecific] = useState(procedure?.isToothSpecific ?? false);
    const [hasQuantity, setHasQuantity] = useState(procedure?.hasQuantity ?? false);
    const [isCheckup, setIsCheckup] = useState(procedure?.isCheckup ?? false);
    const [submitted, setSubmitted] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const isCategory = categories.some((category) => category.id === procedure?.id);
    const fixedParent = newCategory ?? parent?.name ?? null;

    const create = useMutation(trpc.procedure.create.mutationOptions({ onSuccess: onProcedureWritten }));
    const createCategory = useMutation(
        trpc.procedure.createCategory.mutationOptions({ onSuccess: onProcedureWritten }),
    );
    const update = useMutation(trpc.procedure.update.mutationOptions({ onSuccess: onProcedureWritten }));

    const write = usePendingAction((job: () => Promise<unknown>) => job());

    const nameError = submitted && name.trim() === '' ? 'A procedure needs a name.' : undefined;
    const saving = write.pending && !confirming;
    const busy = write.pending;
    const failure = create.error ?? createCategory.error ?? update.error;

    function onSave() {
        setSubmitted(true);
        if (name.trim() === '') return;

        const chosenParent = parentId === NO_CATEGORY ? null : parentId;
        const details = {
            parentId: chosenParent,
            name: name.trim(),
            defaultPrice: poundsToPiastres(price),
            ...(showsCost ? { cost: poundsToPiastres(cost) } : {}),
            hasQuantity,
            isToothSpecific: toothSpecific,
            isCheckup,
        };

        write.run(async () => {
            if (procedure) {
                await update.mutateAsync({ id: procedure.id, ...details });
                onSaved('Procedure saved');
                return;
            }

            if (newCategory !== null) {
                await createCategory.mutateAsync({
                    name: newCategory,
                    sortOrder: nextSortOrder(null),
                    first: {
                        name: details.name,
                        defaultPrice: details.defaultPrice,
                        cost: details.cost,
                        hasQuantity: details.hasQuantity,
                        isToothSpecific: details.isToothSpecific,
                        isCheckup: details.isCheckup,
                    },
                });
                onSaved(t('{category} added', { category: newCategory }));
                return;
            }

            await create.mutateAsync({ ...details, sortOrder: nextSortOrder(chosenParent) });
            onSaved('Procedure added');
        });
    }

    function onHide() {
        if (!procedure) return;
        write.run(async () => {
            await update.mutateAsync({ id: procedure.id, active: false });
            setConfirming(false);
            onSaved('Procedure hidden');
        });
    }

    useBackHandler(() => {
        if (!busy) onClose();
        return true;
    });

    return (
        <Pane
            title={procedure ? 'Edit procedure' : 'New procedure'}
            subtitle={!procedure && fixedParent ? t('Under {parent}', { parent: fixedParent }) : undefined}
            onBack={busy ? () => {} : onClose}
            footer={
                <ActionBar
                    primaryLabel={saving ? 'Saving' : 'Save'}
                    onPrimary={onSave}
                    primaryLoading={saving}
                    primaryDisabled={busy}
                />
            }
        >
            {failure ? (
                <Callout tone="warning" title="Not saved">
                    {errorText(failure)}
                </Callout>
            ) : null}

            <Card padded style={styles.form}>
                {isCategory ? null : (
                    <NumericField
                        label="Price"
                        variant="display"
                        prefix="EGP"
                        value={price}
                        onChangeText={(next) => setPrice(sanitisePounds(next))}
                        placeholder="0"
                        hint="Visits already recorded keep the price they were charged at."
                    />
                )}

                {isCategory || !showsCost ? null : (
                    <NumericField
                        label="Cost to the clinic"
                        prefix="EGP"
                        value={cost}
                        onChangeText={(next) => setCost(sanitisePounds(next))}
                        placeholder="0"
                        hint="Materials and lab fees for one. Only you see it, on Stats. Visits already recorded keep the cost they had."
                        testID="procedure-cost"
                    />
                )}

                <TextField
                    label="Name"
                    required
                    value={name}
                    onChangeText={setName}
                    placeholder="Zirconia crown"
                    maxLength={MAX_PROCEDURE_NAME}
                    error={nameError}
                />

                {isCategory ? (
                    <Callout tone="note">
                        This one has subtypes under it, so it is a heading. The price and the rules belong to
                        each subtype.
                    </Callout>
                ) : newCategory !== null ? (
                    <Callout tone="note">
                        {t(
                            'Saving this makes “{category}” a category with this as its first subtype. A category has no price of its own.',
                            { category: newCategory },
                        )}
                    </Callout>
                ) : (
                    <Select
                        label="Category"
                        options={[
                            { value: NO_CATEGORY, label: 'No category' },
                            ...categories.map((category) => ({
                                value: category.id,
                                label: category.name,
                            })),
                        ]}
                        value={parentId}
                        onChange={setParentId}
                        hint="A procedure inside a category is one of its subtypes, priced on its own."
                        sheetTitle="Category"
                    />
                )}
            </Card>

            {isCategory ? null : (
                <Card>
                    {general ? null : (
                        <>
                            <FlagRow
                                label="Needs a tooth"
                                sub="Asked before it is added."
                                value={toothSpecific}
                                onChange={setToothSpecific}
                            />
                            <CardDivider />
                        </>
                    )}
                    <FlagRow
                        label="Can have a quantity"
                        sub={general ? 'Off: once per visit.' : 'Off: once per visit, per tooth.'}
                        value={hasQuantity}
                        onChange={setHasQuantity}
                    />
                    <CardDivider />
                    <FlagRow
                        label="Waived when other work is done"
                        sub="Added to every visit at check-in, and waived when any other work is done. Only one procedure can hold it."
                        value={isCheckup}
                        onChange={setIsCheckup}
                    />
                </Card>
            )}

            {procedure ? (
                <Card padded style={styles.form}>
                    <Text variant="subhead" tone="muted">
                        {t(
                            'Hiding takes it out of the catalogue and off this screen. Visits that already charged for it keep it, at the price they were charged.',
                        )}
                    </Text>
                    <Button
                        label="Hide procedure"
                        variant="danger"
                        icon={<HideIcon size={15} stroke={color.danger} width={2.2} />}
                        onPress={() => setConfirming(true)}
                        loading={write.pending && confirming}
                        block
                    />
                </Card>
            ) : null}

            <ConfirmSheet
                visible={confirming}
                title="Hide this procedure?"
                body="It stops appearing when adding work to a visit, and comes off this screen for good — you won't be able to bring it back from here. Nothing is deleted: past visits keep it and keep what they charged."
                confirmLabel="Hide"
                destructive
                loading={write.pending && confirming}
                onConfirm={onHide}
                onCancel={() => setConfirming(false)}
            />
        </Pane>
    );
}

type FlagRowProps = {
    label: string;
    sub: string;
    value: boolean;
    onChange: (value: boolean) => void;
};

function FlagRow({ label, sub, value, onChange }: FlagRowProps) {
    const t = useT();
    return (
        <View style={styles.flagRow}>
            <View style={styles.rowText}>
                <Text variant="body" weight="medium">
                    {t(label)}
                </Text>
                <Text variant="subhead" tone="muted">
                    {t(sub)}
                </Text>
            </View>
            <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
        </View>
    );
}

const styles = StyleSheet.create({
    category: { gap: space[2] },
    addRow: { flexDirection: 'row', alignItems: 'stretch', gap: space[2.5] },
    addRowAlone: { justifyContent: 'center' },
    addProcedure: { flex: 1 },
    addCategory: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[2],
        minHeight: size.row,
        paddingHorizontal: space[3.5],
        borderRadius: radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: color.outline,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row + space[2],
        paddingHorizontal: space[4],
        paddingVertical: space[2],
    },
    pressed: { backgroundColor: color.surface2 },
    rowText: { flex: 1, gap: space[1] },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
    form: { gap: space[4] },
    sheetActions: { flexDirection: 'row', gap: space[2] },
    sheetCancel: { flex: 1 },
    sheetConfirm: { flex: 1.4 },
    flagRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        minHeight: size.row,
    },
});
