# Session-Based Trading Rules & Evaluation Criteria (Option B)

This document outlines the systematic rules and campaign-level evaluation criteria for the **Session-Based Daily Trading Strategy**. 

Instead of measuring the performance of individual signals in isolation, this model evaluates a **daily trading campaign** starting at the opening of each day session. The primary goal is to reach a net profit target for the day and then stop trading ("Done for the Day").

---

## 1. Trade Execution Rules (Symmetrical 2-Brick Plan)

Each individual trade setup is executed with a fixed, symmetrical risk profile: a **1:1 Reward-to-Risk ratio** of exactly **2 bricks**.

*   **Entry Trigger**: Enter at the **Close** of a completed signal brick.
    *   *Long (Buy)*: Close of a completed Blue (Up) brick.
    *   *Short (Sell)*: Close of a completed Red (Down) brick.
*   **Profit Target (+2 Bricks)**:
    *   *Long (Buy)*: $\text{Entry Price} + (2 \times \text{brick\_size})$
    *   *Short (Sell)*: $\text{Entry Price} - (2 \times \text{brick\_size})$
*   **Hard Stop Loss (-2 Bricks)**:
    *   *Long (Buy)*: $\text{Entry Price} - (2 \times \text{brick\_size})$
    *   *Short (Sell)*: $\text{Entry Price} + (2 \times \text{brick\_size})$

*Note: For a 15-tick chart on MNQ (where 1 tick = 0.25 points), the brick size is **3.75 points**. Therefore, a 2-brick distance is exactly **7.50 points** (30 ticks).*

---

## 2. Breakeven (BE) Protection Rule

To protect capital, we implement a trailing stop-loss to entry once the trade is halfway to its target.

*   **Trigger Condition**: The trade moves **+1 brick** (+3.75 points) in our favor.
*   **Action**: Move the stop-loss from its initial 2-brick position to the exact **Entry Price** (0 points).
*   **Exit**: If the price reverses and touches the Entry Price, the trade is closed for a **Breakeven (0 points / 0 bricks)** result. 
*   **Outcome**: The trade is concluded, and the system looks for the next setup.

---

## 3. Daily Campaign Rules ("Done for the Day" Rule)

We evaluate the cumulative net profit of all trades taken sequentially during the daily session.

*   **Session Start**: Trading begins at **06:30 AM PST** (or the first completed bar after 6:30 AM).
*   **Trading Continuity**: We take subsequent signals sequentially as they occur throughout the day.
*   **Win & Stop Condition**: As soon as the cumulative net profit for the day reaches **+2 bricks** (+7.5 points), we stop trading for the day and record the day as a **Win**.
*   **No Daily Loss Limit**: If the target is not reached, we continue taking signals until the end of the day session (13:00 PST / 16:00 EST).
*   **Clawback Math Example**:
    *   We start the day at **0 bricks**.
    *   *Trade 1*: Fails (Loss of -2 bricks. Net: `-2`).
    *   *Trade 2*: Fails (Loss of -2 bricks. Net: `-4`).
    *   *Trade 3*: Fails (Loss of -2 bricks. Net: `-6`).
    *   *Recovery*: To reach the daily win target of **+2 bricks**, we now need to capture a total of **8 bricks** of profit (e.g., 4 consecutive wins, or a combination of wins and breakevens) to conclude the day's session:
        $$-6 \text{ (current net)} + 8 \text{ (needed)} = +2 \text{ (daily target)}$$

---

## 4. Key Performance Indicators (KPIs) for Evaluation

When backtesting this model, we measure session-level statistics rather than raw signal win rates:

1.  **Daily Success Rate**: The percentage of trading days that successfully hit the **+2 brick** target.
2.  **Average Time-to-Success**: The average time of day when the +2 brick target is reached (e.g., 07:45 AM).
3.  **Maximum Daily Drawdown**: The worst-case cumulative net loss (in bricks) incurred on days that do not reach the target.
4.  **Breakeven Efficiency**: The number of times the BE rule saved us from a 2-brick loss vs. the number of times it cut off a trade that would have reached the 2-brick target.
5.  **Average Trade Duration**: How long (in minutes or bricks) the trade holds before resolving to a Win, Loss, or Breakeven.
