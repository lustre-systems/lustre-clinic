import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('askToEditOnFinish', () => {
    test('is on for a clinic that has never set it', async () => {
        expect((await settingsService.get()).askToEditOnFinish).toBe(true);
    });

    test('turned off, reads back off', async () => {
        const updated = await settingsService.update({ askToEditOnFinish: false });

        expect(updated.askToEditOnFinish).toBe(false);
        expect((await settingsService.get()).askToEditOnFinish).toBe(false);
    });

    test('is left alone by a save that does not name it', async () => {
        await settingsService.update({ askToEditOnFinish: false });
        await settingsService.update({ clinicName: 'Renamed' });

        expect((await settingsService.get()).askToEditOnFinish).toBe(false);
    });
});
