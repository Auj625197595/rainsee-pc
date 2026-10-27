export interface TopTabRowLayout {
  rows: number;
  rowByIndex: number[];
  ranges: Array<{ start: number; end: number }>;
}

export interface TopTabRowLayoutOptions {
  previousRows?: Array<number | undefined>;
  minimumFootprints?: number[];
  avoidOrphanLastRow?: boolean;
  /**
   * 第 0 行的可用宽度(缺省 = availableWidth)。顶部多行布局中第 0 行夹在品牌块与
   * 工具箱/窗口控制之间,第 1 行起独立成栏占满整条标题栏宽度,两者容量不同。
   */
  firstRowWidth?: number;
}

const positive = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const countPackedRows = (
  weights: number[],
  capacityOf: (row: number) => number,
): number => {
  if (weights.length === 0) return 1;
  let rows = 1;
  let used = 0;
  for (const rawWeight of weights) {
    const weight = positive(rawWeight);
    if (used > 0 && used + weight > capacityOf(rows - 1)) {
      rows++;
      used = weight;
    } else {
      used += weight;
    }
  }
  return rows;
};

/**
 * Chooses the smallest useful row count, then keeps existing row assignments
 * stable whenever capacity permits. Earlier rows are filled before balance is
 * used as the final tie-break for cold starts and explicit layout changes.
 */
export const calculateTopTabRows = (
  footprints: number[],
  availableWidth: number,
  configuredMaxRows: number,
  options: TopTabRowLayoutOptions = {},
): TopTabRowLayout => {
  const weights = footprints.map(positive);
  const maxRows = Math.max(1, Math.min(5, Math.round(configuredMaxRows) || 1));
  const capacity = Math.max(1, positive(availableWidth));
  const firstCapacity = Math.max(
    1,
    positive(options.firstRowWidth ?? availableWidth),
  );
  const capacityOf = (row: number) => (row === 0 ? firstCapacity : capacity);
  const packedRows = countPackedRows(weights, capacityOf);
  const rows = Math.max(
    1,
    Math.min(maxRows, weights.length || 1, packedRows),
  );

  if (weights.length === 0) {
    return { rows: 1, rowByIndex: [], ranges: [] };
  }

  const minimumWeights = weights.map((weight, index) =>
    Math.min(weight, positive(options.minimumFootprints?.[index] ?? weight)),
  );
  const previousRows = options.previousRows || [];
  const capped = packedRows > maxRows;
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  // 各行按容量比例分摊总宽度作为均衡目标(第 0 行较窄,分得更少)。
  const totalCapacity = firstCapacity + capacity * (rows - 1);
  const targetWeightOf = (row: number) =>
    (totalWeight * capacityOf(row)) / totalCapacity;
  const prefix = (values: number[]) => {
    const sums = new Array(values.length + 1).fill(0);
    values.forEach((value, index) => {
      sums[index + 1] = sums[index] + value;
    });
    return sums;
  };
  const preferredSums = prefix(weights);
  const minimumSums = prefix(minimumWeights);
  const movementSums = Array.from({ length: rows }, (_, row) => {
    const moved = new Array(weights.length + 1).fill(0);
    const distance = new Array(weights.length + 1).fill(0);
    for (let index = 0; index < weights.length; index++) {
      const previous = previousRows[index];
      const changed = previous !== undefined && previous !== row;
      moved[index + 1] = moved[index] + (changed ? 1 : 0);
      distance[index + 1] =
        distance[index] +
        (changed ? Math.abs(previous - row) : 0);
    }
    return { moved, distance };
  });

  interface Candidate {
    hardOverflow: number;
    fillableGaps: number;
    moved: number;
    distance: number;
    leadingSlack: number;
    imbalance: number;
    cuts: number[];
  }

  const better = (left: Candidate, right?: Candidate): boolean => {
    if (!right) return true;
    if (left.hardOverflow !== right.hardOverflow)
      return left.hardOverflow < right.hardOverflow;
    if (left.fillableGaps !== right.fillableGaps)
      return left.fillableGaps < right.fillableGaps;
    if (left.moved !== right.moved) return left.moved < right.moved;
    if (left.distance !== right.distance)
      return left.distance < right.distance;
    if (left.leadingSlack !== right.leadingSlack)
      return left.leadingSlack < right.leadingSlack;
    return left.imbalance < right.imbalance;
  };

  // Dynamic programming keeps contiguous row-major ranges while minimizing
  // existing slots that change rows. Balance is deliberately only a tie-break.
  let states = new Map<number, Candidate>();
  states.set(0, {
    hardOverflow: 0,
    fillableGaps: 0,
    moved: 0,
    distance: 0,
    leadingSlack: 0,
    imbalance: 0,
    cuts: [],
  });

  for (let row = 0; row < rows; row++) {
    const nextStates = new Map<number, Candidate>();
    for (const [start, state] of states) {
      const rowsLeft = rows - row - 1;
      const maxEnd = weights.length - rowsLeft;
      for (let end = start + 1; end <= maxEnd; end++) {
        const preferred = preferredSums[end] - preferredSums[start];
        const minimum = minimumSums[end] - minimumSums[start];
        const moved =
          movementSums[row].moved[end] - movementSums[row].moved[start];
        const distance =
          movementSums[row].distance[end] -
          movementSums[row].distance[start];
        const rowCapacity = capacityOf(row);
        const candidate: Candidate = {
          hardOverflow:
            state.hardOverflow +
            Math.max(0, (capped ? minimum : preferred) - rowCapacity),
          fillableGaps:
            state.fillableGaps +
            (row < rows - 1 && preferred + weights[end] <= rowCapacity ? 1 : 0),
          moved: state.moved + moved,
          distance: state.distance + distance,
          leadingSlack:
            state.leadingSlack +
            (row < rows - 1 ? Math.max(0, rowCapacity - preferred) : 0),
          imbalance:
            state.imbalance + Math.abs(preferred - targetWeightOf(row)),
          cuts: [...state.cuts, end],
        };
        if (better(candidate, nextStates.get(end))) {
          nextStates.set(end, candidate);
        }
      }
    }
    states = nextStates;
  }

  const best = states.get(weights.length)!;
  const ranges: Array<{ start: number; end: number }> = [];
  const rowByIndex = new Array(weights.length).fill(0);
  let start = 0;
  best.cuts.forEach((end, row) => {
    ranges.push({ start, end });
    for (let index = start; index < end; index++) rowByIndex[index] = row;
    start = end;
  });

  // A single item on the final row leaves a conspicuous empty tail. When the
  // previous row can absorb it with only a small preferred-width overflow (and
  // without violating minimum widths), prefer the compact layout. With aligned
  // previousRows this normally moves only the newly appended slot.
  if (
    options.avoidOrphanLastRow !== false &&
    rows > 1 &&
    ranges[ranges.length - 1].end - ranges[ranges.length - 1].start === 1
  ) {
    const compact = calculateTopTabRows(
      weights,
      capacity,
      rows - 1,
      { ...options, avoidOrphanLastRow: false },
    );
    const compactMinimumOverflow = compact.ranges.reduce(
      (sum, range, row) =>
        sum +
        Math.max(
          0,
          minimumSums[range.end] -
            minimumSums[range.start] -
            capacityOf(row),
        ),
      0,
    );
    const compactPreferredOverflow = compact.ranges.reduce(
      (sum, range, row) =>
        sum +
        Math.max(
          0,
          preferredSums[range.end] -
            preferredSums[range.start] -
            capacityOf(row),
        ),
      0,
    );
    if (
      compactMinimumOverflow === 0 &&
      compactPreferredOverflow <= Math.max(24, capacity * 0.08)
    ) {
      return compact;
    }
  }

  return { rows, rowByIndex, ranges };
};
