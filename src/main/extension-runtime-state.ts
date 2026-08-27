import { promises } from 'fs';
import { resolve } from 'path';

export const EXTENSION_RUNTIME_STATE_FILE = '.rainsee-extension-runtime.json';
export const MAX_PENDING_INSTALL_ATTEMPTS = 3;
export const MAX_PENDING_INSTALL_AGE_MS = 24 * 60 * 60 * 1000;

interface RuntimeInstallState {
  version: string;
  pendingInstalledDetails?: chrome.runtime.InstalledDetails;
  pendingInstalledAt?: number;
  pendingInstallAttempts?: number;
}

const validPendingDetails = (
  value: any,
): value is chrome.runtime.InstalledDetails =>
  value?.reason === 'install' ||
  (value?.reason === 'update' && typeof value?.previousVersion === 'string');

const statePath = (extensionsPath: string, extensionId: string) =>
  resolve(extensionsPath, extensionId, EXTENSION_RUNTIME_STATE_FILE);

export async function getRuntimeInstallDetails(
  extensionsPath: string,
  extensionId: string,
  version?: string,
): Promise<chrome.runtime.InstalledDetails | null> {
  if (!extensionsPath || !extensionId || !version) return null;
  let state: Partial<RuntimeInstallState> = {};
  try {
    state = JSON.parse(
      await promises.readFile(statePath(extensionsPath, extensionId), 'utf8'),
    );
  } catch {}

  const previousVersion =
    typeof state.version === 'string' ? state.version : '';
  if (
    previousVersion === version &&
    validPendingDetails(state.pendingInstalledDetails)
  ) {
    const pendingAge =
      typeof state.pendingInstalledAt === 'number'
        ? Date.now() - state.pendingInstalledAt
        : 0;
    const attempts =
      typeof state.pendingInstallAttempts === 'number'
        ? state.pendingInstallAttempts
        : 0;
    if (
      attempts >= MAX_PENDING_INSTALL_ATTEMPTS ||
      pendingAge > MAX_PENDING_INSTALL_AGE_MS
    ) {
      try {
        await saveRuntimeInstalledState(extensionsPath, extensionId, version);
      } catch {}
      return null;
    }
    return state.pendingInstalledDetails;
  }
  if (previousVersion && previousVersion !== version) {
    return { reason: 'update', previousVersion };
  }
  return null;
}

export async function saveRuntimeInstalledState(
  extensionsPath: string,
  extensionId: string,
  version?: string,
  pendingInstalledDetails?: chrome.runtime.InstalledDetails,
) {
  if (!extensionsPath || !extensionId || !version) return;
  let previous: Partial<RuntimeInstallState> = {};
  if (pendingInstalledDetails) {
    try {
      previous = JSON.parse(
        await promises.readFile(statePath(extensionsPath, extensionId), 'utf8'),
      );
    } catch {}
  }
  const samePending =
    previous.version === version &&
    JSON.stringify(previous.pendingInstalledDetails) ===
      JSON.stringify(pendingInstalledDetails);
  const pendingInstalledAt =
    samePending && typeof previous.pendingInstalledAt === 'number'
      ? previous.pendingInstalledAt
      : Date.now();
  const pendingInstallAttempts =
    samePending && typeof previous.pendingInstallAttempts === 'number'
      ? previous.pendingInstallAttempts + 1
      : pendingInstalledDetails
      ? 1
      : undefined;
  const state: RuntimeInstallState = {
    version,
    ...(pendingInstalledDetails ? { pendingInstalledDetails } : {}),
    ...(pendingInstalledDetails
      ? { pendingInstalledAt, pendingInstallAttempts }
      : {}),
  };
  await promises.writeFile(
    statePath(extensionsPath, extensionId),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

export async function markRuntimeInstalledDelivered(
  extensionsPath: string,
  extensionId: string,
  version: string,
  details: chrome.runtime.InstalledDetails,
) {
  if (!extensionsPath || !extensionId || !version) return false;
  const runtimePath = statePath(extensionsPath, extensionId);
  let state: RuntimeInstallState;
  try {
    state = JSON.parse(await promises.readFile(runtimePath, 'utf8'));
  } catch {
    return false;
  }
  if (
    state?.version !== version ||
    JSON.stringify(state?.pendingInstalledDetails) !== JSON.stringify(details)
  ) {
    return false;
  }
  await saveRuntimeInstalledState(extensionsPath, extensionId, version);
  return true;
}
