export const inferBrickSize = (data) => {
  const counts = new Map();

  (data || []).forEach((bar) => {
    // A range bar's configured size is its full high-to-low range. Its body can
    // be smaller and is therefore not a reliable way to infer tick thresholds.
    const size = Number(bar.high) - Number(bar.low);
    if (!Number.isFinite(size) || size <= 0) return;

    const key = size.toFixed(10);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const [size] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [15];
  return Number(size);
};

export const inferTickSize = (data) => {
  const scale = 100000000;
  let greatestCommonDivisor = 0;

  (data || []).forEach((bar) => {
    ['open', 'high', 'low', 'close'].forEach((key) => {
      const price = Number(bar[key]);
      if (!Number.isFinite(price)) return;
      const scaledPrice = Math.round(Math.abs(price) * scale);
      if (scaledPrice === 0) return;

      let a = greatestCommonDivisor;
      let b = scaledPrice;
      while (b !== 0) {
        [a, b] = [b, a % b];
      }
      greatestCommonDivisor = a;
    });
  });

  return greatestCommonDivisor > 0 ? greatestCommonDivisor / scale : 1;
};

// The annotation is entered at the close of its bar. A completed outcome is
// determined by the first later bar that reaches either directional threshold:
// Buy: +1 brick success / -2 bricks failure; Sell: -1 brick success / +2 bricks failure.
export const getAnnotationOutcome = (action, entryIndex, bars, brickSize) => {
  const entryBar = bars?.[entryIndex];
  if (
    (action !== 'Buy' && action !== 'Sell') ||
    !entryBar ||
    !Number.isFinite(brickSize) ||
    brickSize <= 0
  ) return null;

  const entryPrice = Number(entryBar.close);
  if (!Number.isFinite(entryPrice)) return null;

  const isBuy = action === 'Buy';
  const successPrice = entryPrice + (isBuy ? brickSize : -brickSize);
  const failurePrice = entryPrice + (isBuy ? -(brickSize * 2) : brickSize * 2);

  for (let index = entryIndex + 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const hitSuccess = isBuy
      ? Number(bar.high) >= successPrice
      : Number(bar.low) <= successPrice;
    const hitFailure = isBuy
      ? Number(bar.low) <= failurePrice
      : Number(bar.high) >= failurePrice;

    // OHLC bars cannot reveal which threshold was hit first when both occur
    // within the same bar, so leave that annotation unscored.
    if (hitSuccess && hitFailure) return null;
    if (hitSuccess) return 'success';
    if (hitFailure) return 'failure';
  }

  return null;
};

const getSessionStartIndex = (barIndex, sessionOpenIndices) => {
  let sessionStart = 0;
  for (const sessionOpenIndex of sessionOpenIndices || []) {
    if (sessionOpenIndex > barIndex) break;
    sessionStart = sessionOpenIndex;
  }
  return sessionStart;
};

const getDirectionalPrice = (entryPrice, action, ticks, tickSize) => (
  entryPrice + (action === 'Buy' ? 1 : -1) * ticks * tickSize
);

const hitsFavorablePrice = (bar, action, price) => (
  action === 'Buy' ? Number(bar.high) >= price : Number(bar.low) <= price
);

const hitsAdversePrice = (bar, action, price) => (
  action === 'Buy' ? Number(bar.low) <= price : Number(bar.high) >= price
);

const closeTradeAtSessionEnd = (
  annotation,
  bars,
  tickSize,
  sessionEndIndex,
  startingCumulativeTicks
) => {
  const entryPrice = Number(bars[annotation.barIndex]?.close);
  const exitPrice = Number(bars[sessionEndIndex]?.close);
  const direction = annotation.action === 'Buy' ? 1 : -1;
  const profitTicks = Math.round(((exitPrice - entryPrice) * direction) / tickSize);

  return {
    exitBarIndex: sessionEndIndex,
    exitPrice,
    exitReason: 'session-end',
    isIntrabarExit: false,
    outcome: profitTicks > 0 ? 'success' : profitTicks < 0 ? 'failure' : 'breakeven',
    profitTicks,
    cumulativeTicks: startingCumulativeTicks + profitTicks,
  };
};

const evaluateTrade = (
  annotation,
  bars,
  brickSize,
  tickSize,
  startingCumulativeTicks,
  sessionEndIndex,
  closesAtSessionEnd
) => {
  const entryPrice = Number(bars[annotation.barIndex]?.close);
  const ticksPerBrick = Math.round(brickSize / tickSize);
  const stopTicks = ticksPerBrick * 2;
  const stopPrice = getDirectionalPrice(entryPrice, annotation.action, -stopTicks, tickSize);
  const isRecoveryTrade = startingCumulativeTicks < 0;
  const targetTicks = isRecoveryTrade ? -startingCumulativeTicks : ticksPerBrick;
  const targetPrice = getDirectionalPrice(entryPrice, annotation.action, targetTicks, tickSize);
  const armPrice = getDirectionalPrice(entryPrice, annotation.action, ticksPerBrick, tickSize);
  let breakEvenArmed = false;

  const completed = (exitBarIndex, exitPrice, exitReason, profitTicks, outcome) => ({
    exitBarIndex,
    exitPrice,
    exitReason,
    isIntrabarExit: true,
    outcome,
    profitTicks,
    cumulativeTicks: startingCumulativeTicks + profitTicks,
  });

  const ambiguous = (exitBarIndex) => ({
    exitBarIndex,
    exitPrice: null,
    exitReason: 'ambiguous',
    isIntrabarExit: true,
    outcome: 'ambiguous',
    profitTicks: null,
    cumulativeTicks: startingCumulativeTicks,
  });

  for (let barIndex = annotation.barIndex + 1; barIndex <= sessionEndIndex; barIndex += 1) {
    const bar = bars[barIndex];
    const hitStop = hitsAdversePrice(bar, annotation.action, stopPrice);
    const hitTarget = hitsFavorablePrice(bar, annotation.action, targetPrice);

    if (!isRecoveryTrade) {
      if (hitStop && hitTarget) return ambiguous(barIndex);
      if (hitTarget) {
        return completed(barIndex, targetPrice, 'target', ticksPerBrick, 'success');
      }
      if (hitStop) {
        return completed(barIndex, stopPrice, 'stop', -stopTicks, 'failure');
      }
      continue;
    }

    const hitArmPrice = hitsFavorablePrice(bar, annotation.action, armPrice);
    const hitEntryPrice = hitsAdversePrice(bar, annotation.action, entryPrice);

    if (!breakEvenArmed) {
      // If a single OHLC bar reaches both sides, its intrabar order is unknowable.
      if (hitStop && (hitTarget || hitArmPrice)) return ambiguous(barIndex);
      if (hitTarget) {
        return completed(barIndex, targetPrice, 'recovery-zero', targetTicks, 'success');
      }
      if (hitStop) {
        return completed(barIndex, stopPrice, 'stop', -stopTicks, 'failure');
      }

      if (hitArmPrice) {
        const closedBackThroughEntry = annotation.action === 'Buy'
          ? Number(bar.close) <= entryPrice
          : Number(bar.close) >= entryPrice;
        if (closedBackThroughEntry) {
          return completed(barIndex, entryPrice, 'protected-breakeven', 0, 'breakeven');
        }
        breakEvenArmed = true;
      }
      continue;
    }

    if (hitTarget && hitEntryPrice) {
      const open = Number(bar.open);
      const openedAtTarget = annotation.action === 'Buy' ? open >= targetPrice : open <= targetPrice;
      const openedAtBreakEven = annotation.action === 'Buy' ? open <= entryPrice : open >= entryPrice;
      if (openedAtTarget) {
        return completed(barIndex, targetPrice, 'recovery-zero', targetTicks, 'success');
      }
      if (openedAtBreakEven) {
        return completed(barIndex, entryPrice, 'protected-breakeven', 0, 'breakeven');
      }
      return ambiguous(barIndex);
    }
    if (hitTarget) {
      return completed(barIndex, targetPrice, 'recovery-zero', targetTicks, 'success');
    }
    if (hitEntryPrice) {
      return completed(barIndex, entryPrice, 'protected-breakeven', 0, 'breakeven');
    }
  }

  if (closesAtSessionEnd) {
    return closeTradeAtSessionEnd(
      annotation,
      bars,
      tickSize,
      sessionEndIndex,
      startingCumulativeTicks
    );
  }

  return {
    exitBarIndex: null,
    exitPrice: null,
    exitReason: 'pending',
    isIntrabarExit: false,
    outcome: 'pending',
    profitTicks: null,
    cumulativeTicks: startingCumulativeTicks,
  };
};

export const buildSessionCumulativeOutcomes = (
  annotations,
  bars,
  brickSize,
  tickSize,
  sessionOpenIndices
) => {
  const ticksPerBrick = Math.round(brickSize / tickSize);
  if (!Number.isFinite(ticksPerBrick) || ticksPerBrick <= 0) return [];

  const orderedAnnotations = (annotations || [])
    .filter(annotation =>
      (annotation.action === 'Buy' || annotation.action === 'Sell') &&
      Number.isInteger(annotation.barIndex) &&
      annotation.barIndex >= 0 &&
      annotation.barIndex < (bars?.length || 0)
    )
    .slice()
    .sort((a, b) => a.barIndex - b.barIndex);

  const orderedSessionOpens = (sessionOpenIndices || []).slice().sort((a, b) => a - b);
  let activeSessionStart = null;
  let cumulativeTicks = 0;
  let previousExitBarIndex = -1;
  const outcomes = [];

  orderedAnnotations.forEach(annotation => {
    const sessionStart = getSessionStartIndex(annotation.barIndex, orderedSessionOpens);
    if (sessionStart !== activeSessionStart) {
      activeSessionStart = sessionStart;
      cumulativeTicks = 0;
      previousExitBarIndex = -1;
    }

    if (annotation.barIndex < previousExitBarIndex) {
      outcomes.push({
        ...annotation,
        startingCumulativeTicks: cumulativeTicks,
        exitBarIndex: null,
        exitPrice: null,
        exitReason: 'overlap-ignored',
        isIntrabarExit: false,
        outcome: 'ignored',
        profitTicks: null,
        cumulativeTicks,
      });
      return;
    }

    const nextSessionOpen = orderedSessionOpens.find(index => index > annotation.barIndex);
    const closesAtSessionEnd = Number.isInteger(nextSessionOpen);
    const sessionEndIndex = closesAtSessionEnd ? nextSessionOpen - 1 : bars.length - 1;
    const startingCumulativeTicks = cumulativeTicks;
    const evaluation = evaluateTrade(
      annotation,
      bars,
      brickSize,
      tickSize,
      startingCumulativeTicks,
      sessionEndIndex,
      closesAtSessionEnd
    );

    if (Number.isFinite(evaluation.profitTicks)) {
      cumulativeTicks = evaluation.cumulativeTicks;
    }
    previousExitBarIndex = Number.isInteger(evaluation.exitBarIndex)
      ? evaluation.exitBarIndex
      : Number.POSITIVE_INFINITY;
    outcomes.push({
      ...annotation,
      startingCumulativeTicks,
      ...evaluation,
    });
  });

  return outcomes;
};
