// Must be first: installs the dev-client runtime (dev menu, bundler picker,
// error overlay) that replaces Expo Go in a development build.
import 'expo-dev-client';
import * as Sentry from '@sentry/react-native';
import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { LISTENER_TASK } from './modules/lustre-listener';
import './src/shell/driveBackupTask';
import { CRASH_REPORTS_ON, startCrashReports } from './src/reporting';

// The desk phone's foreground service holds this task open for as long as it
// runs, and an open task is what keeps JS timers firing in the background. It
// does nothing and never finishes; the service ends it when it stops.
AppRegistry.registerHeadlessTask(LISTENER_TASK, () => () => new Promise<void>(() => {}));

// Before the root mounts, so a crash in the first render is caught. `wrap` adds
// the boundary that records taps, named by `testID` and never by visible text.
startCrashReports();
registerRootComponent(
    CRASH_REPORTS_ON ? Sentry.wrap(App, { touchEventBoundaryProps: { labelName: 'testID' } }) : App,
);
