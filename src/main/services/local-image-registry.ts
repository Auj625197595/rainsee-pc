import {randomUUID} from 'crypto';

import {WEBUI_PROTOCOL} from '~/constants/files';

export const LOCAL_IMAGE_HOST = 'local-image';

const localImages = new Map<string, string>();

export const registerLocalImage = (filePath: string) => {
  const token = randomUUID();
  localImages.set(token, filePath);
  return `${WEBUI_PROTOCOL}://${LOCAL_IMAGE_HOST}/${token}`;
};

export const resolveLocalImageToken = (token: string) =>
  localImages.get(token || '') || '';

export const resolveLocalImageUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== `${WEBUI_PROTOCOL}:` || url.hostname !== LOCAL_IMAGE_HOST) {
      return '';
    }
    return resolveLocalImageToken(url.pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
};
