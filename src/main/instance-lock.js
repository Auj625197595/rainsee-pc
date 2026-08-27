'use strict';

const {createHash} = require('crypto');
const {existsSync, mkdirSync, unlinkSync, writeFileSync} = require('fs');
const {join, resolve} = require('path');

const PROFILE_PREFIX = '--rainsee-profile=';
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const parseProfileName = (argv) => {
  const argument = argv.find((item) => item.startsWith(PROFILE_PREFIX));
  if (!argument) return {present: false, name: null};
  try {
    const name = decodeURIComponent(argument.slice(PROFILE_PREFIX.length))
      .trim()
      .normalize('NFC');
    const invalid =
      !name ||
      Array.from(name).length > 40 ||
      name === '.' ||
      name === '..' ||
      /^[.]/.test(name) ||
      /[\x00-\x1f\x7f]/.test(name) ||
      /[\\/:*?"<>|]/.test(name) ||
      /[. ]$/.test(name) ||
      RESERVED_NAME.test(name);
    return {present: true, name: invalid ? null : name};
  } catch {
    return {present: true, name: null};
  }
};

const shortHash = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

const probeWritableDirectory = (directory) => {
  const probe = join(
    directory,
    `.write-probe-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  );
  try {
    mkdirSync(directory, {recursive: true});
    writeFileSync(probe, '');
    try {
      unlinkSync(probe);
    } catch {}
    return true;
  } catch (error) {
    try {
      unlinkSync(probe);
    } catch {}
    return false;
  }
};

// The lock namespace is deliberately independent from the active data path.
// A pending migration can fall back after the lock is acquired, and removable
// custom storage can disappear between probes. A stable AppData lock prevents
// those path changes from creating two primaries that write the same profile.
const resolveInstanceLock = ({
  app,
  argv = process.argv,
  cwd = process.cwd(),
  pathExists = existsSync,
  probeWritable = probeWritableDirectory,
}) => {
  const profile = parseProfileName(argv);
  const isNightly =
    app.name === '雨见浏览器-nightly' || app.name === '雨见浏览器 Nightly';
  const productName = isNightly ? '雨见浏览器 Nightly' : '雨见浏览器';
  const systemUserData = join(app.getPath('appData'), productName);
  const portable = app.isPackaged && pathExists(join(cwd, 'portable.txt'));
  const installationScope = app.isPackaged
    ? portable
      ? `portable-${shortHash(resolve(cwd))}`
      : 'installed'
    : `development-${shortHash(resolve(cwd))}`;
  const profileScope = profile.name
    ? `profile-${shortHash(profile.name)}`
    : 'main';
  const preferredPath = join(
    systemUserData,
    '.instance-locks',
    installationScope,
    profileScope,
  );
  const preferredWritable = probeWritable(preferredPath);

  return {
    profile,
    lockPath: preferredWritable ? preferredPath : app.getPath('userData'),
    usedFallback: !preferredWritable,
    installationScope,
  };
};

module.exports = {parseProfileName, probeWritableDirectory, resolveInstanceLock};
