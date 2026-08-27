import type {IPermissionRecord} from '~/interfaces';
import {IGNORE_CERTIFICATE_ERRORS_PERMISSION} from '~/utils/permissions';
import type {StorageService} from './storage';

const allowedHosts = new Set<string>();

export const getCertificateErrorHost = (value: string): string => {
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    );
    return url.host.toLowerCase();
  } catch {
    return '';
  }
};

export const isCertificateErrorAllowed = (url: string): boolean => {
  const host = getCertificateErrorHost(url);
  return !!host && allowedHosts.has(host);
};

export const allowCertificateErrorHost = (host: string): void => {
  if (host) allowedHosts.add(host);
};

// certificate-error requires a synchronous callback. Keep the persisted rules
// in memory so the listener can decide without waiting for the database.
export const reloadCertificateErrorPermissions = async (
  storage: Pick<StorageService, 'find'>,
): Promise<void> => {
  const records = await storage.find<IPermissionRecord>({
    scope: 'permissions',
    query: {
      permission: IGNORE_CERTIFICATE_ERRORS_PERMISSION,
      type: 1,
    },
  });

  allowedHosts.clear();
  records.forEach((record) => {
    allowCertificateErrorHost(getCertificateErrorHost(record.url));
  });
};
