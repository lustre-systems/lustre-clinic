import 'expo-dev-client';
import * as Sentry from '@sentry/react-native';
import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { LISTENER_TASK } from './modules/lustre-listener';
import './src/shell/driveBackupTask';
import { CRASH_REPORTS_ON, startCrashReports } from './src/reporting';

AppRegistry.registerHeadlessTask(LISTENER_TASK, () => () => new Promise<void>(() => {}));

startCrashReports();
registerRootComponent(
    CRASH_REPORTS_ON ? Sentry.wrap(App, { touchEventBoundaryProps: { labelName: 'testID' } }) : App,
);
