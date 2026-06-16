using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using PowerLanguage;

namespace PowerLanguage.Indicator {
    public class HeikenAshiExporter : IndicatorObject {
        private VariableSeries<double> m_haOpen;
        private VariableSeries<double> m_haClose;
        private VariableSeries<double> m_ma1;
        private VariableSeries<double> m_ma2;
        private List<string> m_barsJson = new List<string>();
        private bool m_exported = false;

        [Input] public string FileDirectory { get; set; }
        [Input] public string FileName { get; set; }
        [Input] public int MA1Period { get; set; }
        [Input] public string MA1Type { get; set; }
        [Input] public int MA2Period { get; set; }
        [Input] public string MA2Type { get; set; }
        [Input] public bool IncludeRawBars { get; set; }
        [Input] public bool SourceBarsAreAlreadyHeikenAshi { get; set; }

        public HeikenAshiExporter(object ctx) : base(ctx) {
            FileDirectory = @"C:\MultiChartsExports\";
            FileName = "MES_2sec_HA.json";
            MA1Period = 10;
            MA1Type = "EMA";
            MA2Period = 60;
            MA2Type = "SMA";
            IncludeRawBars = false;
            SourceBarsAreAlreadyHeikenAshi = false;
        }

        protected override void Create() {
            m_haOpen = new VariableSeries<double>(this);
            m_haClose = new VariableSeries<double>(this);
            m_ma1 = new VariableSeries<double>(this);
            m_ma2 = new VariableSeries<double>(this);
        }

        protected override void StartCalc() {
            m_barsJson.Clear();
            m_exported = false;
        }

        protected override void CalcBar() {
            double rawOpen = Bars.Open[0];
            double rawHigh = Bars.High[0];
            double rawLow = Bars.Low[0];
            double rawClose = Bars.Close[0];

            double haClose = SourceBarsAreAlreadyHeikenAshi
                ? rawClose
                : (rawOpen + rawHigh + rawLow + rawClose) / 4.0;
            double haOpen;
            if (SourceBarsAreAlreadyHeikenAshi) {
                haOpen = rawOpen;
            } else if (Bars.CurrentBar <= 1) {
                haOpen = (rawOpen + rawClose) / 2.0;
            } else {
                haOpen = (m_haOpen[1] + m_haClose[1]) / 2.0;
            }
            double haHigh = SourceBarsAreAlreadyHeikenAshi
                ? rawHigh
                : Math.Max(rawHigh, Math.Max(haOpen, haClose));
            double haLow = SourceBarsAreAlreadyHeikenAshi
                ? rawLow
                : Math.Min(rawLow, Math.Min(haOpen, haClose));

            m_haOpen.Value = haOpen;
            m_haClose.Value = haClose;

            double ma1Val = CalculateMovingAverage(m_haClose, m_ma1, MA1Period, MA1Type);
            double ma2Val = CalculateMovingAverage(m_haClose, m_ma2, MA2Period, MA2Type);
            m_ma1.Value = ma1Val;
            m_ma2.Value = ma2Val;

            string timeStr = Bars.Time[0].ToString("yyyy-MM-ddTHH:mm:ss");
            string openStr = FormatPrice(haOpen);
            string highStr = FormatPrice(haHigh);
            string lowStr = FormatPrice(haLow);
            string closeStr = FormatPrice(haClose);
            string ma1Str = FormatAverage(ma1Val);
            string ma2Str = FormatAverage(ma2Val);

            string barStr = string.Format(
                "{{\"time\":\"{0}\",\"open\":{1},\"high\":{2},\"low\":{3},\"close\":{4},\"ma1\":{5},\"ma2\":{6},\"ma1Period\":{7},\"ma1Type\":\"{8}\",\"ma2Period\":{9},\"ma2Type\":\"{10}\"",
                timeStr,
                openStr,
                highStr,
                lowStr,
                closeStr,
                ma1Str,
                ma2Str,
                Math.Max(1, MA1Period),
                JsonEscape(NormalizeAverageType(MA1Type)),
                Math.Max(1, MA2Period),
                JsonEscape(NormalizeAverageType(MA2Type))
            );

            if (IncludeRawBars) {
                barStr += string.Format(
                    ",\"rawOpen\":{0},\"rawHigh\":{1},\"rawLow\":{2},\"rawClose\":{3}",
                    FormatPrice(rawOpen),
                    FormatPrice(rawHigh),
                    FormatPrice(rawLow),
                    FormatPrice(rawClose)
                );
            }

            barStr += "}";
            m_barsJson.Add(barStr);

            if (Bars.LastBarOnChart && !m_exported) {
                WriteJsonFile();
                m_exported = true;
            }
        }

        private double CalculateMovingAverage(
            VariableSeries<double> source,
            VariableSeries<double> averageSeries,
            int period,
            string averageType
        ) {
            int safePeriod = Math.Max(1, period);
            string normalizedType = NormalizeAverageType(averageType);

            if (normalizedType == "EMA") {
                if (Bars.CurrentBar <= 1) {
                    return source[0];
                }
                double multiplier = 2.0 / (safePeriod + 1.0);
                return (source[0] - averageSeries[1]) * multiplier + averageSeries[1];
            }

            int barsAvailable = Math.Min(safePeriod, Math.Max(1, Bars.CurrentBar));
            double sum = 0.0;
            for (int i = 0; i < barsAvailable; i++) {
                sum += source[i];
            }
            return sum / barsAvailable;
        }

        private string NormalizeAverageType(string averageType) {
            if (averageType == null) {
                return "SMA";
            }
            string upper = averageType.Trim().ToUpperInvariant();
            if (upper == "EMA" || upper == "EXPONENTIAL") {
                return "EMA";
            }
            return "SMA";
        }

        private string FormatPrice(double value) {
            return value.ToString("F4", System.Globalization.CultureInfo.InvariantCulture);
        }

        private string FormatAverage(double value) {
            return value.ToString("F6", System.Globalization.CultureInfo.InvariantCulture);
        }

        private string JsonEscape(string value) {
            if (value == null) {
                return "";
            }
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private void WriteJsonFile() {
            try {
                if (!Directory.Exists(FileDirectory)) {
                    Directory.CreateDirectory(FileDirectory);
                }
                string fullPath = Path.Combine(FileDirectory, FileName);
                StringBuilder sb = new StringBuilder();
                sb.AppendLine("[");
                sb.AppendLine(string.Join("," + System.Environment.NewLine, m_barsJson));
                sb.AppendLine("]");
                File.WriteAllText(fullPath, sb.ToString());
                Output.WriteLine("Heiken Ashi data successfully exported to: " + fullPath);
            } catch (Exception ex) {
                Output.WriteLine("Heiken Ashi export failed: " + ex.Message);
            }
        }
    }
}
