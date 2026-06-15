# MultiCharts.NET Renko Data Exporter Guide

This guide explains how to compile, configure, and run the C# study to export Renko bar data from MultiCharts.NET, and how to import that data into our strategy analysis workspace.

---

## 1. How the C# Exporter Works

The C# exporter is implemented as an Indicator Study in MultiCharts.NET ([RenkoDataExporter.cs](file:///home/msloan/git/renko-trading/multicharts/RenkoDataExporter.cs)).

When applied to a chart, it executes the following logic:
1.  **Warm-up & Initialization**: Triggers `StartCalc()` to clear any previous bars from memory.
2.  **Bar Iteration**: MultiCharts passes each completed Renko bar (including wicks) on the chart through the `CalcBar()` method sequentially.
3.  **EMA Calculation**: For each bar, it calculates the Exponential Moving Average (EMA) of the Close prices based on your input length (default: `8`).
4.  **JSON Formatting**: It formats each bar's parameters (Timestamp, Open, High, Low, Close, EMA) into a JSON object string. It uses `CultureInfo.InvariantCulture` to guarantee that decimal numbers use a dot (`.`) separator instead of a comma (`,`), ensuring universal JSON validity.
5.  **Single-Write Execution**: Once the indicator reaches the **very last bar** on the chart (`Bars.LastBarOnChart`), it concatenates the accumulated bar objects into a JSON array and writes it to your Windows filesystem at `C:\MultiChartsExports\[FileName].json`.

---

## 2. MultiCharts Setup & Compilation

To install the indicator in MultiCharts:

1.  Open the **PowerLanguage Editor** in MultiCharts.
2.  Select **File** -> **New** -> **Indicator**.
3.  Select **C#** as the programming language and name it `RenkoDataExporter`.
4.  Copy and paste the entire contents of [RenkoDataExporter.cs](file:///home/msloan/git/renko-trading/multicharts/RenkoDataExporter.cs) into the editor.
5.  Click **Compile** (F7). Ensure the output window shows a successful build.

---

## 3. Running the Export on a Chart

1.  Open a Renko chart in MultiCharts (e.g., `MNQ` 15-point Renko with wicks enabled).
2.  Right-click the chart and select **Insert Study**.
3.  Select the **Indicators** tab, choose `RenkoDataExporter`, and click **OK**.
4.  In the **Inputs** tab, you will see three properties:
    *   `FileDirectory`: Default is `C:\MultiChartsExports\`.
    *   `FileName`: Name of the file (e.g., `temp_export.json`).
    *   `EMAPeriod`: The length of the EMA (default: `8`).
5.  Click **OK** to apply. The indicator will run instantly, write the file, and output a confirmation in the PowerLanguage Editor Output Window:
    ```
    Renko data successfully exported to: C:\MultiChartsExports\temp_export.json
    ```

---

## 4. Ingesting the JSON Data into the Project

Once the JSON file is saved in your Windows environment at `C:\MultiChartsExports\`, it needs to be imported into the WSL-based project directory `/home/msloan/git/renko-trading/data/` so the frontend dashboard and backtester can access it.

We support two ways to do this:

### Option A: Let the AI Do the Ingestion (Recommended)
Because I have access to your Windows drives via the WSL mount point `/mnt/c/`, you can simply ask me to import the file directly in our chat:
> *"Import temp_export.json as MNQ_15pt_June"*

I will then automatically:
1.  Locate `/mnt/c/MultiChartsExports/temp_export.json`.
2.  Copy and rename it to `/home/msloan/git/renko-trading/data/MNQ_15pt_June.json`.
3.  Run a JSON structural validator to verify the file is well-formed.
4.  Confirm it is ready—it will immediately show up in the React app's sidebar.

### Option B: Manual WSL Command Ingestion
If you prefer to move the file yourself, run the following command in your WSL terminal:
```bash
cp /mnt/c/MultiChartsExports/temp_export.json /home/msloan/git/renko-trading/data/MNQ_15pt_June.json
```

---

## 5. Exported JSON Schema Reference

The exported file will be formatted as a JSON array of bar objects:
```json
[
  {
    "time": "2026-06-09T08:30:00",
    "open": 19000.00,
    "high": 19015.00,
    "low": 18998.00,
    "close": 19015.00,
    "ema": 19000.0000
  },
  {
    "time": "2026-06-09T08:31:00",
    "open": 19015.00,
    "high": 19030.00,
    "low": 19012.00,
    "close": 19030.00,
    "ema": 19008.0000
  }
]
```

*   **`time`**: The chart timestamp of the Renko bar completion.
*   **`open` / `close`**: The pricing borders of the Renko brick body.
*   **`high` / `low`**: The highest and lowest prices reached during the building of that brick (capturing the visual wicks/tails).
*   **`ema`**: The exact value of the Exponential Moving Average at the completion of that bar.
