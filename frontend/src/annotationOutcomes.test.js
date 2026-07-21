import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionCumulativeOutcomes,
  getAnnotationOutcome,
  inferBrickSize,
  inferTickSize,
} from './annotationOutcomes.js';

const entry = { open: 99.75, high: 100.5, low: 99.25, close: 100 };
const bar = (high, low) => ({ open: low, high, low, close: high });

test('infers a five-tick range from full bar ranges, not variable bodies', () => {
  const bars = [
    { open: 100, high: 101.25, low: 100, close: 101 },
    { open: 101, high: 101.5, low: 100.25, close: 100.5 },
    { open: 100.5, high: 101, low: 99.75, close: 100.75 },
  ];

  assert.equal(inferBrickSize(bars), 1.25);
  assert.equal(inferTickSize(bars), 0.25);
});

test('Buy ignores an eight-tick decline and succeeds at five ticks above entry', () => {
  const bars = [entry, bar(100.5, 98), bar(101.25, 98.5)];
  assert.equal(getAnnotationOutcome('Buy', 0, bars, 1.25), 'success');
});

test('Buy fails only when ten ticks below entry is reached first', () => {
  const bars = [entry, bar(100.5, 97.5), bar(101.25, 98)];
  assert.equal(getAnnotationOutcome('Buy', 0, bars, 1.25), 'failure');
});

test('Sell succeeds when five ticks below entry is reached first', () => {
  const bars = [entry, bar(101, 98.75), bar(102.5, 99)];
  assert.equal(getAnnotationOutcome('Sell', 0, bars, 1.25), 'success');
});

test('Sell fails only when ten ticks above entry is reached first', () => {
  const bars = [entry, bar(102.5, 99.5), bar(101, 98.75)];
  assert.equal(getAnnotationOutcome('Sell', 0, bars, 1.25), 'failure');
});

test('uses the favorable-first assumption when one bar reaches both thresholds', () => {
  const bars = [entry, bar(101.25, 97.5)];
  assert.equal(getAnnotationOutcome('Buy', 0, bars, 1.25), 'success');
});

test('accumulates five-tick wins and ten-tick losses, resetting at session opens', () => {
  const bars = [
    entry,
    bar(101.25, 99), // Buy at index 0 succeeds: +5
    { open: 101, high: 102.25, low: 101, close: 102 },
    { open: 102, high: 102.5, low: 101.25, close: 101.25 },
    bar(100, 98.75), // Sell at index 3 succeeds: +5, new session
    { open: 99, high: 99.5, low: 98.25, close: 99 },
    bar(99.5, 96.5), // Buy at index 5 fails: -10
  ];
  const annotations = [
    { action: 'Buy', barIndex: 0 },
    { action: 'Sell', barIndex: 3 },
    { action: 'Buy', barIndex: 5 },
  ];

  const outcomes = buildSessionCumulativeOutcomes(annotations, bars, 1.25, 0.25, [0, 3]);
  assert.deepEqual(
    outcomes.map(({ barIndex, cumulativeTicks }) => ({ barIndex, cumulativeTicks })),
    [
      { barIndex: 0, cumulativeTicks: 5 },
      { barIndex: 3, cumulativeTicks: 5 },
      { barIndex: 5, cumulativeTicks: -5 },
    ]
  );
});

test('recovery trade exits as soon as it restores a negative session to zero', () => {
  const bars = [
    { open: 100, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 100.5, low: 97.5, close: 98 }, // first Buy: -10
    { open: 99.5, high: 100.5, low: 99.25, close: 100 }, // recovery Buy entry
    { open: 100, high: 101.25, low: 99.75, close: 101.25 }, // arm BE at +5
    { open: 101.25, high: 102.5, low: 101, close: 102.5 }, // recover +10
  ];
  const outcomes = buildSessionCumulativeOutcomes(
    [{ action: 'Buy', barIndex: 0 }, { action: 'Buy', barIndex: 2 }],
    bars,
    1.25,
    0.25,
    [0]
  );

  assert.deepEqual(
    outcomes.map(({ exitReason, profitTicks, cumulativeTicks }) => ({ exitReason, profitTicks, cumulativeTicks })),
    [
      { exitReason: 'stop', profitTicks: -10, cumulativeTicks: -10 },
      { exitReason: 'recovery-zero', profitTicks: 10, cumulativeTicks: 0 },
    ]
  );
});

test('recovery trade exits at trade break-even after first reaching five ticks', () => {
  const bars = [
    { open: 100, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 100.5, low: 97.5, close: 98 },
    { open: 99.5, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 101.25, low: 99.75, close: 101.25 },
    { open: 101.25, high: 101.5, low: 100, close: 100 },
  ];
  const outcomes = buildSessionCumulativeOutcomes(
    [{ action: 'Buy', barIndex: 0 }, { action: 'Buy', barIndex: 2 }],
    bars,
    1.25,
    0.25,
    [0]
  );

  assert.equal(outcomes[1].exitReason, 'protected-breakeven');
  assert.equal(outcomes[1].profitTicks, 0);
  assert.equal(outcomes[1].cumulativeTicks, -10);
});

test('armed Buy recovery exits profitably at the first opposite-color close', () => {
  const bars = [
    { open: 100, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 100.5, low: 97.5, close: 98 }, // first Buy: -10
    { open: 99.5, high: 100.5, low: 99.25, close: 100 }, // recovery Buy entry
    // The low touches entry inside the arm bar, but the bar finishes at +5.
    // Best-case ordering treats that low as occurring before the favorable run.
    { open: 100.25, high: 101.25, low: 100, close: 101.25 },
    { open: 101.25, high: 101.5, low: 100.5, close: 100.75 }, // red close at +3
  ];
  const outcomes = buildSessionCumulativeOutcomes(
    [{ action: 'Buy', barIndex: 0 }, { action: 'Buy', barIndex: 2 }],
    bars,
    1.25,
    0.25,
    [0]
  );

  assert.equal(outcomes[1].exitReason, 'opposite-close');
  assert.equal(outcomes[1].exitPrice, 100.75);
  assert.equal(outcomes[1].profitTicks, 3);
  assert.equal(outcomes[1].cumulativeTicks, -7);
  assert.equal(outcomes[1].isIntrabarExit, false);
});

test('armed recovery break-even touch takes priority over a later opposite-color close', () => {
  const bars = [
    { open: 100, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 100.5, low: 97.5, close: 98 },
    { open: 99.5, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 101.25, low: 100, close: 101.25 },
    { open: 101.25, high: 101.5, low: 100, close: 100.75 },
  ];
  const outcomes = buildSessionCumulativeOutcomes(
    [{ action: 'Buy', barIndex: 0 }, { action: 'Buy', barIndex: 2 }],
    bars,
    1.25,
    0.25,
    [0]
  );

  assert.equal(outcomes[1].exitReason, 'protected-breakeven');
  assert.equal(outcomes[1].profitTicks, 0);
  assert.equal(outcomes[1].cumulativeTicks, -10);
});

test('same-bar recovery conflicts follow the favorable-first state transition', () => {
  const bars = [
    { open: 100, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 100.5, low: 97.5, close: 98 }, // first Buy: -10
    { open: 99.5, high: 100.5, low: 99.25, close: 100 }, // recovery entry
    { open: 100, high: 101.25, low: 97.5, close: 98 }, // +5 and -10 in one bar
  ];
  const outcomes = buildSessionCumulativeOutcomes(
    [{ action: 'Buy', barIndex: 0 }, { action: 'Buy', barIndex: 2 }],
    bars,
    1.25,
    0.25,
    [0]
  );

  assert.equal(outcomes[1].exitReason, 'protected-breakeven');
  assert.equal(outcomes[1].profitTicks, 0);
  assert.equal(outcomes[1].cumulativeTicks, -10);
});

test('armed Sell recovery uses the first blue close and its actual profit', () => {
  const bars = [
    { open: 100, high: 100.75, low: 99.5, close: 100 },
    { open: 100, high: 102.5, low: 99.5, close: 102 }, // first Sell: -10
    { open: 100.5, high: 100.75, low: 99.5, close: 100 }, // recovery Sell entry
    { open: 100, high: 100, low: 98.75, close: 98.75 }, // arm at +5
    { open: 98.75, high: 99.5, low: 98.5, close: 99.25 }, // blue close at +3
  ];
  const outcomes = buildSessionCumulativeOutcomes(
    [{ action: 'Sell', barIndex: 0 }, { action: 'Sell', barIndex: 2 }],
    bars,
    1.25,
    0.25,
    [0]
  );

  assert.equal(outcomes[1].exitReason, 'opposite-close');
  assert.equal(outcomes[1].profitTicks, 3);
  assert.equal(outcomes[1].cumulativeTicks, -7);
});

test('a five-tick recovery target takes priority when the deficit is five ticks', () => {
  const bars = [
    { open: 100, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 101.25, low: 99.75, close: 101.25 }, // +5
    { open: 101.25, high: 101.75, low: 100.5, close: 101.25 },
    { open: 101.25, high: 101.75, low: 98.75, close: 99 }, // -10 => cumulative -5
    { open: 99.5, high: 100.25, low: 99, close: 100 },
    { open: 100, high: 101.25, low: 99.75, close: 101.25 }, // +5 => cumulative zero
  ];
  const outcomes = buildSessionCumulativeOutcomes(
    [
      { action: 'Buy', barIndex: 0 },
      { action: 'Buy', barIndex: 2 },
      { action: 'Buy', barIndex: 4 },
    ],
    bars,
    1.25,
    0.25,
    [0]
  );

  assert.equal(outcomes[2].exitReason, 'recovery-zero');
  assert.equal(outcomes[2].profitTicks, 5);
  assert.equal(outcomes[2].cumulativeTicks, 0);
});

test('closes an open trade at the last close before a new session and resets afterward', () => {
  const bars = [
    { open: 100, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 100.75, low: 99.5, close: 100.5 },
    { open: 100.5, high: 101, low: 99.75, close: 100.5 },
    { open: 105, high: 105.5, low: 104.25, close: 105 },
    { open: 105, high: 106.25, low: 104.75, close: 106.25 },
  ];
  const outcomes = buildSessionCumulativeOutcomes(
    [{ action: 'Buy', barIndex: 0 }, { action: 'Buy', barIndex: 3 }],
    bars,
    1.25,
    0.25,
    [0, 3]
  );

  assert.equal(outcomes[0].exitReason, 'session-end');
  assert.equal(outcomes[0].profitTicks, 2);
  assert.equal(outcomes[0].cumulativeTicks, 2);
  assert.equal(outcomes[1].startingCumulativeTicks, 0);
  assert.equal(outcomes[1].cumulativeTicks, 5);
});

test('flags overlapping signals and scores same-bar conflicts favorable-first', () => {
  const overlapBars = [
    { open: 100, high: 100.5, low: 99.25, close: 100 },
    { open: 100, high: 100.75, low: 99.5, close: 100.5 },
    { open: 100.5, high: 101.25, low: 100, close: 101.25 },
  ];
  const overlap = buildSessionCumulativeOutcomes(
    [{ action: 'Buy', barIndex: 0 }, { action: 'Sell', barIndex: 1 }],
    overlapBars,
    1.25,
    0.25,
    [0]
  );
  assert.equal(overlap[1].exitReason, 'overlap-ignored');
  assert.equal(overlap[1].profitTicks, null);

  const sameBarConflictBars = [entry, bar(101.25, 97.5)];
  const favorableFirst = buildSessionCumulativeOutcomes(
    [{ action: 'Buy', barIndex: 0 }],
    sameBarConflictBars,
    1.25,
    0.25,
    [0]
  );
  assert.equal(favorableFirst[0].exitReason, 'target');
  assert.equal(favorableFirst[0].cumulativeTicks, 5);
});
