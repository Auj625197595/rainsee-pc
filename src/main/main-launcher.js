'use strict';

global.__rainseeStartupMarks = global.__rainseeStartupMarks || [];
const launcherMark = (phase, details) => {
  const mark = global.__rainseeStartupMark;
  if (typeof mark === 'function') {
    mark(phase, details);
    return;
  }
  global.__rainseeStartupMarks.push({
    phase,
    atMs: Math.round(process.uptime() * 1000),
    details,
  });
};

launcherMark('launcher.entered');
const {app} = require('electron');
const {resolveInstanceLock} = require('./instance-lock.js');
launcherMark('launcher.modules_loaded');

const originalAppName = app.name;
const isNightly = originalAppName === '雨见浏览器-nightly';
// Match bootstrap-paths while resolving Electron's default data paths, then
// restore the raw name so the full entry can still detect the nightly build.
app.name = isNightly ? '雨见浏览器 Nightly' : '雨见浏览器';

const defaultUserData = app.getPath('userData');
const defaultSessionData = app.getPath('sessionData');
const {profile, lockPath: lockUserData, usedFallback, installationScope} =
  resolveInstanceLock({app});
launcherMark('launcher.profile_parsed', {
  profileArgument: profile.present,
  profileValid: !profile.present || !!profile.name,
  installationScope,
});
launcherMark('launcher.lock_path_resolved', {
  packaged: app.isPackaged,
  usedFallback,
  installationScope,
});

// Invalid profile arguments are handled by the full entry's existing error
// dialog. Valid launches use the stable namespace resolved above.
let acquired = true;
if (!profile.present || profile.name) {
  app.setPath('userData', lockUserData);
  app.setPath('sessionData', lockUserData);
  const lockStartedAt = Math.round(process.uptime() * 1000);
  launcherMark('launcher.single_instance_lock.begin');
  acquired = app.requestSingleInstanceLock();
  launcherMark('launcher.single_instance_lock.end', {
    acquired,
    durationMs: Math.max(0, Math.round(process.uptime() * 1000) - lockStartedAt),
  });
}

if (!acquired) {
  // requestSingleInstanceLock has synchronously handed argv to the primary.
  // Do not enter Electron's graceful shutdown path for this throwaway process;
  // it keeps the Windows busy cursor and helper processes alive noticeably longer.
  launcherMark('launcher.secondary_exit');
  app.exit(0);
} else {
  // bootstrap-paths owns the real path decision and migration. Restore the
  // untouched defaults before loading it; the already acquired lock remains
  // scoped to lockUserData for this process lifetime.
  app.name = originalAppName;
  app.setPath('userData', defaultUserData);
  app.setPath('sessionData', defaultSessionData);

  global.__rainseeSecondInstanceQueue = [];
  global.__rainseeSecondInstanceHandler = null;
  app.on('second-instance', (_event, argv) => {
    const handler = global.__rainseeSecondInstanceHandler;
    if (typeof handler === 'function') handler(argv);
    else global.__rainseeSecondInstanceQueue.push(argv);
  });

  launcherMark('launcher.main_bundle.require.begin');
  require('./main.bundle.js');
  launcherMark('launcher.main_bundle.require.end');
}
