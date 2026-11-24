import type { RouterInput, RouterOutput } from '../../types';
import { type BranchRow, getDb, save } from '../db';
import { assignDefined, DemoError, uuidv7 } from '../rules';
import type { Dated } from '../wire';

type Branch = Dated<RouterOutput['branch']['list'][number]>;

export const branchHandlers = {
    list(input: RouterInput['branch']['list']): Branch[] {
        const rows = [...getDb().branches].sort((a, b) => a.name.localeCompare(b.name));
        return input?.includeInactive ? rows : rows.filter((row) => row.active);
    },

    byId(id: string): BranchRow {
        const row = getDb().branches.find((branch) => branch.id === id);
        if (!row) throw DemoError.notFound('branch');
        return row;
    },

    create(input: RouterInput['branch']['create']): Branch {
        const row: BranchRow = {
            id: uuidv7(),
            name: input.name,
            address: input.address ?? null,
            active: true,
            whatsappApp: input.whatsappApp ?? 'regular',
        };

        getDb().branches.push(row);
        save();
        return row;
    },

    update(input: RouterInput['branch']['update']): Branch {
        const { id, ...patch } = input;
        const row = branchHandlers.byId(id);

        assignDefined(row, patch);
        save();
        return row;
    },
};
