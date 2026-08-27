const MIN_DOWNLOAD_SPEED_BYTES_PER_SECOND = 1;

export const normalizeDownloadSpeed = (speed?: number): number =>
  typeof speed === 'number' &&
  Number.isFinite(speed) &&
  speed >= MIN_DOWNLOAD_SPEED_BYTES_PER_SECOND
    ? speed
    : 0;
