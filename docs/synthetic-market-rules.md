# Rules for Generating Realistic Synthetic Renko Markets

This document outlines the mathematical formulas, constraints, and algorithmic rules required to generate realistic synthetic Renko market data. These rules ensure that the synthetic data behaves exactly like live market data under a standard Renko filter with wicks (tails).

---

## 1. Fundamental Renko Definitions

A Renko chart filters out time and displays price movement based on a fixed price step.

*   **Brick Size ($B$)**: A fixed positive real number representing the vertical size of each Renko brick body.
*   **Direction**: Every brick has a direction, either **Up** (Bullish / Blue) or **Down** (Bearish / Red).
*   **Body Boundaries**: Each brick has an `Open` and a `Close` price.
    *   **Up Brick**: $Close = Open + B$
    *   **Down Brick**: $Close = Open - B$
*   **Wick (Tail) Extremes**: Each brick has a `High` and a `Low` price representing the maximum price excursion during the brick's formation.

---

## 2. Body Placement and Continuation/Reversal Rules

Let the previous completed brick be $Brick_{n-1}$ with open $O_{prev}$ and close $C_{prev}$. Let the continuous tick stream since its completion be $P_t$. 

A new brick $Brick_n$ starts forming with its base tracking the previous brick's boundaries.

### Rule A: Continuation
A continuation occurs when the price continues moving in the *same* direction as $Brick_{n-1}$ by one brick size $B$.

1.  **If $Brick_{n-1}$ was UP ($C_{prev} > O_{prev}$)**:
    *   Continuation is triggered when $P_t \ge C_{prev} + B$.
    *   The new Up brick has:
        $$\begin{aligned}
        Open_n &= C_{prev} \\
        Close_n &= C_{prev} + B
        \end{aligned}$$
2.  **If $Brick_{n-1}$ was DOWN ($C_{prev} < O_{prev}$)**:
    *   Continuation is triggered when $P_t \le C_{prev} - B$.
    *   The new Down brick has:
        $$\begin{aligned}
        Open_n &= C_{prev} \\
        Close_n &= C_{prev} - B
        \end{aligned}$$

### Rule B: Reversal (2-Box Reversal Rule)
A reversal occurs when the price moves in the *opposite* direction of $Brick_{n-1}$ by at least **two brick sizes** ($2 \times B$) from the previous close $C_{prev}$.

1.  **If $Brick_{n-1}$ was UP ($C_{prev} > O_{prev}$)**:
    *   Reversal is triggered when $P_t \le C_{prev} - 2B = O_{prev} - B$.
    *   The new Down brick has:
        $$\begin{aligned}
        Open_n &= O_{prev} \\
        Close_n &= O_{prev} - B
        \end{aligned}$$
2.  **If $Brick_{n-1}$ was DOWN ($C_{prev} < O_{prev}$)**:
    *   Reversal is triggered when $P_t \ge C_{prev} + 2B = O_{prev} + B$.
    *   The new Up brick has:
        $$\begin{aligned}
        Open_n &= O_{prev} \\
        Close_n &= O_{prev} + B
        \end{aligned}$$

> [!IMPORTANT]
> **No Body Overlap Invariant**
> Consecutive Renko brick bodies **never** overlap vertically. They share horizontal boundaries at their Open/Close levels, but their vertical ranges are entirely disjoint. Specifically:
> *   An Up brick occupies $[O_n, C_n]$.
> *   A reversal Down brick occupies $[O_{prev} - B, O_{prev}]$, while the previous Up brick occupied $[O_{prev}, O_{prev} + B]$.

---

## 3. Wick (Tail) Formation and Mathematical Constraints

Wicks represent the price pullbacks that occur during the formation of a Renko brick before it is completed. These are subject to strict directional and length constraints based on standard Renko filter math.

### Rule A: Direction of Wicks
*   **Up Bricks (Bullish)**:
    *   Can only have a **lower wick** representing a downward pullback.
    *   **Cannot have an upper wick**. An Up brick is completed at the exact instant the price reaches $Close = Open + B$. The price cannot exceed $Close$ prior to completion. Therefore, $High_n = Close_n$ always.
*   **Down Bricks (Bearish)**:
    *   Can only have an **upper wick** representing an upward pullback.
    *   **Cannot have a lower wick**. A Down brick is completed at the exact instant the price reaches $Close = Open - B$. The price cannot fall below $Close$ prior to completion. Therefore, $Low_n = Close_n$ always.

### Rule B: Mathematical Wick Size Constraints (Safety Bounds)
Because the tick stream is continuous, if a pullback exceeds the reversal or continuation threshold, it will trigger a new brick of the opposite color instead of completing the current one. To prevent impossible wicks (wicks that should have formed a new brick instead of a tail), we apply the following bounds:

Let $l_n$ be the minimum price and $h_n$ be the maximum price recorded in the temporary tick stream during the formation of $Brick_n$.

#### 1. Continuation Up Brick
*   Previous brick was UP. Current brick is a continuation UP.
*   $Open_n = C_{prev}$, $Close_n = C_{prev} + B$.
*   A reversal Down brick would trigger if price drops to $C_{prev} - 2B = Open_n - 2B$.
*   **Wick Constraint**: The pullback low ($Low_n$) must be strictly greater than $Open_n - 2B$.
*   **Safety Implementation**:
    $$Low_n = \max\left(l_n, Open_n - 2B + \epsilon\right)$$
    *(where $\epsilon$ is a tiny positive value, e.g., 0.5 points, to keep the price strictly inside the threshold).*

#### 2. Reversal Up Brick
*   Previous brick was DOWN. Current brick is a reversal UP.
*   $Open_n = O_{prev}$, $Close_n = O_{prev} + B$.
*   A continuation Down brick would trigger if price falls to $C_{prev} = Open_n - B$.
*   **Wick Constraint**: The pullback low ($Low_n$) must be strictly greater than $Open_n - B$.
*   **Safety Implementation**:
    $$Low_n = \max\left(l_n, Open_n - B + \epsilon\right)$$

#### 3. Continuation Down Brick
*   Previous brick was DOWN. Current brick is a continuation DOWN.
*   $Open_n = C_{prev}$, $Close_n = C_{prev} - B$.
*   A reversal Up brick would trigger if price rises to $C_{prev} + 2B = Open_n + 2B$.
*   **Wick Constraint**: The pullback high ($High_n$) must be strictly less than $Open_n + 2B$.
*   **Safety Implementation**:
    $$High_n = \min\left(h_n, Open_n + 2B - \epsilon\right)$$

#### 4. Reversal Down Brick
*   Previous brick was UP. Current brick is a reversal DOWN.
*   $Open_n = O_{prev}$, $Close_n = O_{prev} - B$.
*   A continuation Up brick would trigger if price rises to $C_{prev} = Open_n + B$.
*   **Wick Constraint**: The pullback high ($High_n$) must be strictly less than $Open_n + B$.
*   **Safety Implementation**:
    $$High_n = \min\left(h_n, Open_n + B - \epsilon\right)$$

---

## 4. Rules for Simulating a Realistic Continuous Price Path

Simply choosing directions (e.g., Up, Down, Up) leads to artificial, illegal price jumps and overlapping bricks. A realistic synthetic market must be generated by running a continuous high-frequency tick stream simulation through a stateful Renko filter.

The continuous price path $P_t$ is simulated using a stateful Random Walk with Drift:
$$P_t = P_{t-1} + \mu_s + \epsilon_t$$
where $\mu_s$ is the drift parameter (trend bias) and $\epsilon_t \sim \mathcal{N}(0, \sigma^2)$ is normal random noise.

### Rule A: The Micro-State Machine (Impulse vs. Correction)
Real markets do not move linearly. They expand via strong impulses in the trend direction and contract via corrective pullbacks. To simulate this behavior:
1.  **Impulse Mode**: The drift $\mu_{impulse}$ is aligned with the macro trend direction and runs for a random duration (e.g., 45 to 75 ticks).
2.  **Correction Mode**: The drift $\mu_{correction}$ is applied in the *opposite* direction to simulate profit-taking and retracements. It runs for a shorter duration (e.g., 25 to 50 ticks).

This alternation is what enables the tick stream to pull back enough to generate realistic, long wicks and occasional counter-trend bricks without breaking the macro trend.

### Rule B: Macro Market Regimes (Phases)
To generate a tradeable, non-random synthetic market (e.g., 300 to 500 bars), the simulation must progress through distinct structural phases:

1.  **Strong Trend (Expansion Phase)**:
    *   **Characteristics**: Long runs of continuation bricks, rare reversals, and shallow wicks.
    *   **Parameters**: High impulse drift ($|\mu_{impulse}| \ge 1.1$), lower noise ($\sigma \le 1.5$), and corrective pullbacks that fail to breach reversal thresholds.
2.  **Weak / Choppy Trend**:
    *   **Characteristics**: Slow-moving trends with frequent reversals and alternating brick colors.
    *   **Parameters**: Lower impulse drift ($|\mu_{impulse}| \le 0.5$) and higher noise ($\sigma \ge 3.0$).
3.  **Consolidation / Chop (Range-Bound Phase)**:
    *   **Characteristics**: Sideways market with a flat 8 EMA, bounded price action, and alternating brick colors.
    *   **Parameters**: Modeled using a mean-reverting Ornstein-Uhlenbeck-like process:
        $$\mu_t = -\theta \cdot (P_t - P_{center})$$
        where $\theta$ is the speed of mean reversion (e.g., $0.06$) and noise is high ($\sigma \ge 4.0$).
4.  **Congestion Zone**:
    *   **Characteristics**: Clumped price action where price fluctuates heavily within a narrow band (e.g., 1.5 brick sizes), resulting in overlapping wicks and multiple direction reversals.
    *   **Parameters**: High noise ($\sigma \ge 4.2$) with a weak drift, keeping the price bound to a dynamic top/bottom center.
