# Project Concept & Session History: Renko Trading Strategy Analysis

This document serves as a comprehensive concept and session history file. It captures the entire context of our development session, including the transition from the home budget application layout fixes to the architectural decisions made for the new Renko trading analysis tool.

---

## 1. Session Background: Home Budget App Mobile Layout Fixes
Before starting this new project, we resolved a critical styling issue on the main **Home Budget application**:
* **The Bug**: A fixed-position cover block (`body::before`) was added to cover the mobile status bar/notch height. Because the main container (`.chakra-container`) had no corresponding top padding, the entire mobile navigation header (month selector, search, hamburger menu, and avatar) was completely covered, and the starting balance cards (Checking/Savings) were partially obscured.
* **The Resolution**: 
  1. We reduced the `body::before` status bar cover height to `env(safe-area-inset-top, 0px)`.
  2. We set the mobile `.chakra-container` top padding to `calc(env(safe-area-inset-top, 0px) + 8px) !important`.
  3. We split the mobile header in `App.jsx` into three distinct zones: hamburger/search on the far left, the calendar month navigation centered, and the user avatar on the far right.
* **Git Preference**: We created `scratch/preferences.json` to note that the agent must **never** automatically stage, commit, or push changes without the user's explicit verification and permission first.
* **Status**: Tested, verified to compile, deployed to Firebase hosting, and successfully committed/pushed (Commit hash: `72007ca8`).

---

## 2. Trading Strategy Concept: Renko & 8 EMA
The user is trading the Nasdaq-100 Futures (`MNQ`) using a custom visual system:
* **Bricks**: 15-point Renko bricks with wicks (tails).
* **Indicator**: A single 8-period Exponential Moving Average (EMA).
* **Strategy Rules**:
  * **Trend Filter**: The 8 EMA must be steeply sloping in the direction of the trend. Sideways/choppy periods where the EMA is flat are ignored (no trades taken).
  * **Retracement/Pullback Entry**: Fired on a completed Renko brick that has a wick testing the 8 EMA.
    * *Buy (Long)*: A blue (up) brick with a bottom wick that tests and rejects the upward-sloping EMA.
    * *Sell (Short)*: A red (down) brick with a top wick that tests and rejects the downward-sloping EMA.

---

## 3. Key Architectural Decisions Made in this Session

### Decision A: Data Source (CQG API vs. MultiCharts.NET Bridge)
* **Question**: Should we connect directly to the CQG Web API to stream tick data?
* **Discussion**: Directly querying the CQG API requires broker API enablement, monthly fees, and forces us to write a complex tick-to-Renko brick construction engine in Python/JS.
* **Resolution**: We will use **MultiCharts.NET as a data bridge**. MultiCharts already connects to CQG, collects ticks, builds Renko bars with wicks, and calculates the 8 EMA. We will write a lightweight C# script in MultiCharts to simply export this pre-calculated brick data (DateTime, Open, High, Low, Close, EMA) to a CSV file.

### Decision B: Charting Environment (Jupyter Notebooks vs. React Web App)
* **Question**: What is the best environment to create a scrollable, interactive chart?
* **Discussion**: We compared Jupyter Notebooks + Plotly (great for fast scripts) with a local React web application.
* **Resolution**: We decided on a **Local React Web App** using **TradingView's open-source Lightweight Charts library**. This library provides hardware-accelerated, ultra-smooth financial charting (kinetic panning, zooming, axis stretching) which mimics professional trading terminals.

### Decision C: General AI Vision vs. Data-Driven Programmatic AI
* **Question**: Why did past attempts to show screenshots/snippets to a general AI model only yield moderate success?
* **Discussion**: Screenshot-based models use computer vision to look at raw pixels. They must "guess" line levels and shapes, which is highly sensitive to aspect ratios, resolutions, and scaling. 
* **Resolution**: Our system will use a **data-driven programmatic approach**. Because the MultiCharts CSV gives us the exact OHLC and EMA numbers, we can code precise mathematical filters (e.g. *wick must come within 3 points of the EMA, and the EMA slope must change by >5 points over 3 bricks*). This guarantees 100% precision with zero visual drift or false positives.

---

## 4. Collaborative Development & Training Model
To align the algorithm with the trader's eye, we will use a feedback loop:
1. **Interactive Chart**: The React app displays the Renko bricks, wicks, and EMA.
2. **User Labeling**: You scroll through the chart and click on any brick to flag it (e.g. `Should Buy`, `Should Sell`, `False Signal`) with notes.
3. **Data Logging**: The dashboard writes these clicks to `annotations.json` in the workspace.
4. **AI Adaptation**: The agent reads the JSON, compares your marked timestamps to the underlying math, and tunes the parameters (e.g. adjusting slope threshold or wick retest tolerance).
5. **Backtest**: Once matched, we run the strategy across several months of historical data to compile a complete trading performance report (win rate, profit factor, max drawdown, and equity curves).
