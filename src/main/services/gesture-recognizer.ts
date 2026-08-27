export interface GesturePoint {
  x: number;
  y: number;
}

export const GESTURE_GRID = 12;
export const GESTURE_MIN_PATH = 24;
export const GESTURE_MIN_SAMPLE = 2;

const quantize = (dx: number, dy: number) =>
  Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'R' : 'L') : dy >= 0 ? 'D' : 'U';

export const recognizeGesture = (points: GesturePoint[]): string | null => {
  if (!points || points.length < 2) return null;

  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  if (total < GESTURE_MIN_PATH) return null;

  const tokens: string[] = [];
  let segmentX = 0;
  let segmentY = 0;
  let lastToken: string | null = null;
  for (let i = 1; i < points.length; i++) {
    segmentX += points[i].x - points[i - 1].x;
    segmentY += points[i].y - points[i - 1].y;
    const length = Math.hypot(segmentX, segmentY);
    if (length < GESTURE_GRID) continue;

    const token = quantize(segmentX, segmentY);
    if (token !== lastToken) {
      tokens.push(token);
      lastToken = token;
    }
    const carry = length - GESTURE_GRID;
    segmentX = (segmentX / length) * carry;
    segmentY = (segmentY / length) * carry;
  }

  return tokens.length > 0 ? tokens.join('') : null;
};
