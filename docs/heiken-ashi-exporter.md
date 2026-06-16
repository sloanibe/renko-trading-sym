# Heiken Ashi Exporter

`multicharts/HeikenAshiExporter.cs` exports Heiken Ashi OHLC bars plus two configurable moving averages to JSON.

Default output:

```json
{
  "time": "2026-06-16T09:30:02",
  "open": 7530.1250,
  "high": 7531.0000,
  "low": 7529.7500,
  "close": 7530.6250,
  "ma1": 7530.420000,
  "ma2": 7528.910000,
  "ma1Period": 10,
  "ma1Type": "EMA",
  "ma2Period": 60,
  "ma2Type": "SMA"
}
```

Inputs:

- `FileDirectory`: defaults to `C:\MultiChartsExports\`
- `FileName`: defaults to `MES_2sec_HA.json`
- `MA1Period`: defaults to `10`
- `MA1Type`: `EMA` or `SMA`, defaults to `EMA`
- `MA2Period`: defaults to `60`
- `MA2Type`: `EMA` or `SMA`, defaults to `SMA`
- `IncludeRawBars`: include original chart OHLC as `rawOpen/rawHigh/rawLow/rawClose`
- `SourceBarsAreAlreadyHeikenAshi`: set to `true` when the chart itself is already a Heiken Ashi chart, so the exporter does not calculate HA a second time

Recommended setups:

- Apply to normal 2-second MES bars: leave `SourceBarsAreAlreadyHeikenAshi = false`
- Apply to an existing Heiken Ashi chart: set `SourceBarsAreAlreadyHeikenAshi = true`
