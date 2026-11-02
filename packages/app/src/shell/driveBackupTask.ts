/**
 * The daily Drive backup with the app closed. Android runs this when it suits
 * the battery, so the task asks every six hours and `backUpIfDue` decides: asking
 * only once a day would let each late run push the next one later still.
 *
 * Defined on import from the app's entry point, because Android may start the JS
 * for this alone and the task must exist by the time it asks for it.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { backUpIfDue } from '../api';

const TASK = 'lustre.drive-backup';
const EVERY_MINUTES = 6 * 60;

TaskManager.defineTask(TASK, async () => {
    try {
        await backUpIfDue();
        return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
        return BackgroundTask.BackgroundTaskResult.Failed;
    }
});

export async function registerDriveBackupTask(): Promise<void> {
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MINUTES });
}

export async function unregisterDriveBackupTask(): Promise<void> {
    if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK);
}
