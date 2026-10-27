export const MIN_TOP_TAB_ROWS = 1;
export const MAX_TOP_TAB_ROWS = 5;

export const normalizeTopTabRows = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return MIN_TOP_TAB_ROWS;
  }
  return Math.max(
    MIN_TOP_TAB_ROWS,
    Math.min(MAX_TOP_TAB_ROWS, Math.round(value)),
  );
};
