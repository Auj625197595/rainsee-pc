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

// 与 Chrome 一致，证书例外按主机名生效、不区分端口：放行 itsm.example.com 后,
// 同主机 :8081 子框架(子框架没有证书错误页，无法单独放行)也能加载。
// 持久化记录仍保存带端口的 host,仅内存匹配时去掉端口。
const getCertificateErrorHostname = (value: string): string => {
  const host = getCertificateErrorHost(value);
  if (!host) return '';
  try {
    return new URL(`https://${host}`).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export const isCertificateErrorAllowed = (url: string): boolean => {
  const hostname = getCertificateErrorHostname(url);
  return !!hostname && allowedHosts.has(hostname);
};

export const allowCertificateErrorHost = (host: string): void => {
  const hostname = getCertificateErrorHostname(host);
  if (hostname) allowedHosts.add(hostname);
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
