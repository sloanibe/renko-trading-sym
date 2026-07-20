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
