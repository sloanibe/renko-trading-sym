import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnnotationOutcome, inferBrickSize } from './annotationOutcomes.js';

const entry = { open: 99.75, high: 100.5, low: 99.25, close: 100 };
const bar = (high, low) => ({ open: low, high, low, close: high });

test('infers a five-tick range from full bar ranges, not variable bodies', () => {
  const bars = [
    { open: 100, high: 101.25, low: 100, close: 101 },
    { open: 101, high: 101.5, low: 100.25, close: 100.5 },
    { open: 100.5, high: 101, low: 99.75, close: 100.75 },
  ];

  assert.equal(inferBrickSize(bars), 1.25);
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

test('does not score an OHLC bar that reaches both thresholds', () => {
  const bars = [entry, bar(101.25, 97.5)];
  assert.equal(getAnnotationOutcome('Buy', 0, bars, 1.25), null);
});
