/**
 * range_long_tails projection rules
 * Derived from labeled MESM_reg_5 training annotations.
 *
 * Buy:  long lower wick (>= 3 ticks), body above steeply rising EMA,
 *       bodies may only kiss/overlap by <= 1 tick, lower wick reaches
 *       prior body (within 1 tick).
 * Sell: long upper wick (>= 3 ticks), body under steeply falling EMA,
 *       same structural constraints; doji bodies (close == open) allowed.
 */
export const RANGE_LONG_TAILS_SET = 'range_long_tails';

const DEFAULTS = {
  tickSize: 0.25,
  minTailTicks: 3,
  emaSlopeLookback: 3,
  // Softened from 1.2 after false-negative labels (slopes ~1.04–1.19).
  minEmaSlope: 1.0,
  // Allow a 1-tick body kiss (bar 4082) without opening full overlap.
  maxBodyOverlapTicks: 1,
  // Wick may miss prior body by up to 1 tick and still count as rejection.
  tailProximityTicks: 1,
};

function bodyRange(bar) {
  return [Math.min(bar.open, bar.close), Math.max(bar.open, bar.close)];
}

function bodyOverlapAmount(a, b) {
  const [a0, a1] = bodyRange(a);
  const [b0, b1] = bodyRange(b);
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return Math.max(0, hi - lo);
}

function tailNearPreviousBody(bar, prev, side, pad) {
  const [pb0, pb1] = bodyRange(prev);
  if (side === 'buy') {
    const wickLo = bar.low;
    const wickHi = Math.min(bar.open, bar.close);
    return !(wickHi < pb0 - pad || wickLo > pb1 + pad);
  }
  const wickLo = Math.max(bar.open, bar.close);
  const wickHi = bar.high;
  return !(wickHi < pb0 - pad || wickLo > pb1 + pad);
}

/**
 * @param {Array} data OHLC+EMA bars
 * @param {object} [options]
 * @param {Set<number>|number[]} [options.excludeBarIndexes] bars already labeled (skip projecting)
 * @returns {Array<{barIndex,timestamp,action,markerSet,isProjection,projectionRule,comment,metrics}>}
 */
export function projectRangeLongTails(data, options = {}) {
  if (!Array.isArray(data) || data.length === 0) return [];

  const tickSize = options.tickSize ?? DEFAULTS.tickSize;
  const minTail = (options.minTailTicks ?? DEFAULTS.minTailTicks) * tickSize;
  const lookback = options.emaSlopeLookback ?? DEFAULTS.emaSlopeLookback;
  const minSlope = options.minEmaSlope ?? DEFAULTS.minEmaSlope;
  const maxBodyOverlap = (options.maxBodyOverlapTicks ?? DEFAULTS.maxBodyOverlapTicks) * tickSize;
  const tailPad = (options.tailProximityTicks ?? DEFAULTS.tailProximityTicks) * tickSize;
  const exclude = options.excludeBarIndexes instanceof Set
    ? options.excludeBarIndexes
    : new Set(options.excludeBarIndexes || []);

  const projections = [];

  for (let i = Math.max(lookback, 1); i < data.length; i += 1) {
    if (exclude.has(i)) continue;

    const bar = data[i];
    const prev = data[i - 1];
    const ema = bar?.ema;
    const pastEma = data[i - lookback]?.ema;
    if (!Number.isFinite(ema) || !Number.isFinite(pastEma)) continue;
    if (bodyOverlapAmount(bar, prev) > maxBodyOverlap + 1e-12) continue;

    const { open: o, high: h, low: l, close: c } = bar;
    const lowerWick = Math.min(o, c) - l;
    const upperWick = h - Math.max(o, c);
    const slope = ema - pastEma;

    // Buy: above rising EMA with long lower rejection wick
    if (
      slope >= minSlope &&
      lowerWick >= minTail &&
      c >= o - 1e-9 &&
      l >= ema &&
      Math.min(o, c) >= ema &&
      tailNearPreviousBody(bar, prev, 'buy', tailPad)
    ) {
      projections.push({
        barIndex: i,
        timestamp: bar.time,
        action: 'Buy',
        markerSet: RANGE_LONG_TAILS_SET,
        isProjection: true,
        projectionRule: RANGE_LONG_TAILS_SET,
        comment: `AI projection: lower wick ${ (lowerWick / tickSize).toFixed(0) } ticks, EMA slope ${slope.toFixed(2)} over ${lookback} bars`,
        metrics: { open: o, high: h, low: l, close: c, ema },
      });
      continue;
    }

    // Sell: under falling EMA with long upper rejection wick (doji OK)
    if (
      slope <= -minSlope &&
      upperWick >= minTail &&
      c <= o + 1e-9 &&
      h <= ema &&
      Math.max(o, c) <= ema &&
      tailNearPreviousBody(bar, prev, 'sell', tailPad)
    ) {
      projections.push({
        barIndex: i,
        timestamp: bar.time,
        action: 'Sell',
        markerSet: RANGE_LONG_TAILS_SET,
        isProjection: true,
        projectionRule: RANGE_LONG_TAILS_SET,
        comment: `AI projection: upper wick ${ (upperWick / tickSize).toFixed(0) } ticks, EMA slope ${slope.toFixed(2)} over ${lookback} bars`,
        metrics: { open: o, high: h, low: l, close: c, ema },
      });
    }
  }

  return projections;
}

export function isProjectableSignalSet(setName) {
  return setName === RANGE_LONG_TAILS_SET;
}
