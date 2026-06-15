# Trading Method: Renko & 8 EMA Trend Following Strategy

This is a living document that defines the systematic rules, mathematical parameters, and discretionary filters of the Renko Trading Strategy. We will update this document as we analyze data, collect feedback, and optimize the strategy parameters.

---

## 1. System Setup & Chart Configuration

The strategy is built on Nasdaq-100 Futures (`MNQ`) and other E-mini indices utilizing:
*   **Renko Bricks**: Custom Renko bricks with wicks (tails). The brick size is configurable depending on the market volatility (e.g., 8, 15, or 20 points).
*   **Primary Indicator**: A single 8-period Exponential Moving Average (EMA) calculated on the Close price of the Renko bricks.
*   **Visual Environment**: Standard MultiCharts.NET chart layout (Neutral gray background, blue up-bricks, red down-bricks, black wicks, and green 8 EMA).

---

## 2. Core Entry Signals (Wick Rejections)

Trades are entered exclusively on retracements (pullbacks) to the 8 EMA during established trends. We look for a specific visual signature consisting of:
1.  **A Steeply Rising or Declining EMA** (indicating strong directional momentum).
2.  **A Long-Tailed Renko Brick** (representing a powerful rejection of the EMA).
3.  **Proximity to the EMA** (ensuring the brick remains close to the line and is not over-extended).

---

## 3. High-Probability Trade Signature & Parameters

To turn these visual cues into math, we evaluate three key attributes on every setup:

### A. EMA Slope (Trend Momentum)
*   **The Visual Cue**: The 8 EMA must be pointing clearly up or down. A shallow or flat EMA shows weakness, even if a wick touches it.
*   **The Math**: We measure the price change of the EMA over a lookback window of $S$ bricks (e.g., `EMA[0] - EMA[3]`).
*   **Rule**: The absolute slope value must exceed `ema_slope_threshold` (e.g., $\ge$ 2.0 points). If the slope is less, the trend is too weak.

### B. Long-Tailed Wicks (Strong Rejection)
*   **The Visual Cue**: We want to see a pronounced wick (tail) extending from the brick body to the EMA. A short wick shows a weak test; a long wick shows that the counter-trend push was violently rejected, which is a high-probability reversal signal.
*   **The Math**: 
    *   **Long (Buy)**: Rejection wick length is calculated as `Open - Low`.
    *   **Short (Sell)**: Rejection wick length is calculated as `High - Open`.
*   **Rule**: The wick length must be at least `min_wick_length` (e.g., $\ge$ 5.0 points or 20 ticks). Short wicks are ignored.

### C. Proximity to the EMA (No Over-Extension)
*   **The Visual Cue**: The setup bar must close close to the 8 EMA. If the brick body finishes far away from the line, we are "chasing" the trade and risking a late entry.
*   **The Math**: We measure the absolute distance between the entry trigger price (the brick's `Close`) and the `EMA` value.
*   **Rule**: The distance `|Close - EMA|` must not exceed `max_ema_distance` (e.g., $\le$ 20.0 points). If the brick has moved too far away by the time it closes, the trade is skipped.

---

### D. Entry Trigger Mechanics

#### Long Entry (Buy)
*   The 8 EMA is steeply sloping upward (`EMA[0] - EMA[3] >= ema_slope_threshold`).
*   A completed **Blue (Up)** Renko brick closes.
*   The bottom wick is long (`Open - Low >= min_wick_length`).
*   The bottom wick successfully tests the EMA (`Low - tolerance <= EMA <= Open + tolerance`).
*   The wick does not pierce too far past the EMA (`EMA - Low <= max_ema_pierce`).
*   The close is close to the line (`Close - EMA <= max_ema_distance`).

#### Short Entry (Sell)
*   The 8 EMA is steeply sloping downward (`EMA[0] - EMA[3] <= -ema_slope_threshold`).
*   A completed **Red (Down)** Renko brick closes.
*   The top wick is long (`High - Open >= min_wick_length`).
*   The top wick successfully tests the EMA (`Open - tolerance <= EMA <= High + tolerance`).
*   The wick does not pierce too far past the EMA (`High - EMA <= max_ema_pierce`).
*   The close is close to the line (`EMA - Close <= max_ema_distance`).

---

## 3. Market Structure Filters (Arity vs. Congestion)

A key discretionary overlay is **Arity**: we only trade when there is a clear, clean momentum move. We must filter out sideways consolidation and "clumped" price action where multiple bars overlap in a tight region.

We will test three mathematical definitions to detect and skip **Congestion Zones**:

### A. The Directional Reversal Counter (Chop Filter)
*   **Concept**: Sideways chop is marked by alternating brick colors.
*   **Rule**: If there are more than 2 direction changes (Blue-to-Red or Red-to-Blue) within the last 6 completed bricks, classify the market as "Congested" and disable new entries.

### B. The EMA Body-Intersect Rule (Overlapping Filter)
*   **Concept**: In a strong trend, the EMA runs parallel to the bricks, staying completely outside the bodies. In congestion, the EMA repeatedly cuts through the middle of the brick bodies.
*   **Rule**: If the 8 EMA intersects the body (between Open and Close) of more than 2 of the last 5 bricks, do not trade.

### C. Signal Proximity Box (Clumped Trade Filter)
*   **Concept**: Avoid entering consecutive trades in the same horizontal price zone.
*   **Rule**: If a signal occurs within 5 bricks of a previous entry, and the entry price is within 1.5 brick sizes of the previous entry, skip the signal as it is part of the same congestion cluster.

---

## 4. Signal Quality Evaluation

Performance measures entry-signal quality only:
*   Entry is the signal brick's close.
*   A signal passes when one same-direction 15-tick brick completes beyond the entry close.
*   A signal fails when price exceeds the signal brick's tail by 2 MNQ ticks (0.50 points) first.
*   If both thresholds occur within the same OHLC bar, the result is conservatively counted as a failure.
*   Signals without a later outcome are pending and excluded from the pass-rate denominator.

---

## 5. Parameter Optimization Log

The following parameters have been iteratively tuned using the AI feedback loop (comparing `annotations.json` with `backtester.py` results):

| Parameter Name | Description | Initial Value | Optimized Value |
| :--- | :--- | :--- | :--- |
| `EMAPeriod` | Lookback for Exponential Moving Average | 8 | **8** |
| `ema_slope_threshold` | Min change in EMA price over 3 bricks | 2.0 pts | **1.0 pt** (High Momentum Trend) |
| `wick_retest_tolerance`| Max distance from wick extreme to EMA for a "touch" | 2.0 pts | **21.0 pts** (Fast trend trailing) |
| `max_ema_pierce` | Max distance price can overshoot EMA | 1.5 pts | **1.75 pts** |
| `min_wick_length` | Min tail length required to show strong rejection | 5.0 pts | **5.0 pts** |
| `max_ema_distance` | Max distance from brick close to EMA (over-extension) | 20.0 pts | **60.0 pts** (Lagging EMA clearance) |
| `congestion_lookback` | Lookback for chop/overlap checks | 6 bricks | **6 bricks** |
| `tick_size` | MNQ minimum price increment | 0.25 pts | **0.25 pts** |
| `tail_break_ticks` | Adverse move beyond signal tail | 2 ticks | **2 ticks** |
