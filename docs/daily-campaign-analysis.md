# Daily Session Campaign (Option B) - Initial Backtest Analysis

This document outlines the performance, statistics, and observations of the **Daily Session Campaign (Option B)** trading strategy based on initial backtesting on the 15-tick ($3.75$ points) MNQ futures dataset.

---

## 📊 Executive Summary

The Daily Session Campaign simulates sequential, one-at-a-time trading starting at the market open (**06:30 AM PST**). The goal is to reach a **net daily profit of +2.0 bricks** ($+15.00$ gross on MNQ per contract), at which point trading immediately halts for the day (**"Win"**). Individual trades use a symmetrical **2-brick target** ($+7.50$ points) and **2-brick stop-loss** ($-7.50$ points), with a **breakeven (BE) trigger** once profit reaches $+1.0$ brick ($+3.75$ points).

### Core Metrics (MNQ 15-tick Dataset)
* **Total Trading Days**: 36 days (sessions with at least one signal)
* **Daily Success Rate**: **100.00%** (36 / 36 days hit the +2.0 brick target)
* **Average Time to Success**: **09:02 AM PST**
* **Worst-Case Intraday Drawdown**: **-16.00 bricks** (experienced on May 11, 2026)

---

## 📈 Statistical Distributions

To understand the system's day-to-day behavior, we analyzed how often the strategy achieves "quick success" compared to getting trapped in long, range-bound drawdowns.

### 1. Trades per Session
This measures how many trades are executed before the daily +2.0 brick target is hit.

| Category | Trade Count | Number of Days | Percentage |
| :--- | :--- | :--- | :--- |
| **Quick Days** | 1 – 3 trades | 21 days | **58.3%** |
| **Moderate Days** | 4 – 10 trades | 7 days | **19.4%** |
| **Grind Days** | More than 10 trades | 8 days | **22.2%** |

* **Insight**: In **77.7% of all sessions**, the daily campaign is resolved in 10 or fewer trades.

### 2. Session Duration
This measures the elapsed time from the first trade entry to hitting the daily target.

| Category | Time Elapsed | Number of Days | Percentage |
| :--- | :--- | :--- | :--- |
| **Super Quick** | $\le 10$ minutes | 24 days | **66.7%** |
| **Quick** | 10 – 30 minutes | 7 days | **19.4%** |
| **Medium** | 30 – 60 minutes | 3 days | **8.3%** |
| **Long Grind** | $> 60$ minutes | 2 days | **5.6%** |

* **Insight**: **86.1% of all successful days** finish in **under 30 minutes**. Only 2 out of 36 days took longer than an hour of active trading.

---

## 🔍 Key Behavioral Observations

### 1. The "Easy Snipe" (One & Done)
On **66.7% of days**, the strategy requires very little market exposure. It takes a single setup right at the open (or shortly after) and hits the target immediately. This minimizes capital risk and psychological stress.

### 2. The "Drawdown recovery" (May 11 Outlier)
On **May 11, 2026**, the system ran for **5.5 hours** and executed **75 trades**. 
* The system fell into a deep drawdown, bottoming out twice at **-16.0 bricks** (Trade 26 and Trade 28).
* Since the campaign has **no daily loss limit**, the system kept trading. It eventually caught a strong trend, winning **15 of the next 20 trades** to climb all the way back to the **+2.0 brick** daily target at 11:58 PST.
* While mathematically successful (recovering to a win), this highlights the tail risk of range-bound choppy sessions.

---

## ⚠️ Real-World Challenges

1. **Transaction Fees & Commissions**:
   On MNQ, a 2-brick win pays **+$15.00** gross per contract. Typical commissions run **$1.00 to $2.00 round-trip** per contract.
   * On **Quick Days (1-3 trades)**, commission is negligible ($2 to $6), leaving a solid net profit.
   * On **Grind Days (e.g., May 11 with 75 trades)**, commissions total **$75.00 to $150.00**, transforming a gross +$15.00 profit into a **major net loss**.

2. **Execution Slippage**:
   During choppy range markets, Renko bars form extremely fast. Executing **23 trades in 16 minutes** (as seen on May 27) requires fully automated execution. Order slippage during high-speed fills will degrade the symmetrical 2-brick targets and stops, eating into profit margins.

3. **Capital Cushion Requirement**:
   To survive the worst-case drawdown (-16.0 bricks), a trader must have a capital cushion of at least 16 bricks ($120 per MNQ contract) and the psychological fortitude to allow the system to keep executing setups while deeply in the red.

---

## 🧪 Proposed Future Experiments

To optimize this strategy for live trading, we can run backtests simulating the following rules:

### 1. Session Trade Cap
Stop trading for the day after a fixed number of trades.
* **Proposal**: Test caps of **5**, **10**, or **15** maximum trades per session.
* **Hypothesis**: This will decrease the daily win rate (some grind days will close as losses), but will prevent massive commission bills and protect capital during range-bound chop.

### 2. Session Loss Limit
Stop trading for the day if the net profit falls to a certain threshold.
* **Proposal**: Test daily stop-out limits of **-4.0 bricks** or **-6.0 bricks**.
* **Hypothesis**: Limits worst-case session drawdown from -16.0 bricks to -6.0 bricks.

### 3. Larger Renko Brick Size
Run the simulation on larger brick sizes (e.g., **30-tick** or **45-tick** Renko).
* **Hypothesis**: Slows down the speed of bar generation, filters out market noise, reduces overall trade frequency, and decreases the commission-to-profit ratio.

### 4. Trend Filter Integration
Only allow trade entries in the direction of the longer-term **24 EMA** or **30 EMA**.
* **Hypothesis**: Avoids entering counter-trend trades during range expansions, reducing the number of whipsaw losses on choppy days.
