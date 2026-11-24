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
