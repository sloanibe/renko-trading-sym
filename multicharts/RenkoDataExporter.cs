using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using PowerLanguage;
using PowerLanguage.Function;

namespace PowerLanguage.Indicator {
    public class RenkoDataExporter : IndicatorObject {
        private VariableSeries<double> m_ema;
        private List<string> m_barsJson = new List<string>();
        private bool m_exported = false;

        [Input] public string FileDirectory { get; set; }
        [Input] public string FileName { get; set; }
        [Input] public int EMAPeriod { get; set; }

        public RenkoDataExporter(object ctx) : base(ctx) {
            FileDirectory = @"C:\MultiChartsExports\";
            FileName = "MNQ_15pt.json";
            EMAPeriod = 8;
        }

        protected override void Create() {
            m_ema = new VariableSeries<double>(this);
        }

        protected override void StartCalc() {
            m_barsJson.Clear();
            m_exported = false;
        }

        protected override void CalcBar() {
            // Calculate 8 EMA on Close manually to avoid Functions dependency
            double close = Bars.Close[0];
            double emaVal;
            if (Bars.CurrentBar <= 1) {
                emaVal = close;
            } else {
                double prevEma = m_ema[1]; // retrieve value from previous bar
                double multiplier = 2.0 / (Math.Max(1, EMAPeriod) + 1.0);
                emaVal = (close - prevEma) * multiplier + prevEma;
            }
            m_ema.Value = emaVal;

            // Formulate bar JSON string by formatting values to strings first to prevent compiler/parser bugs
            string timeStr = Bars.Time[0].ToString("yyyy-MM-ddTHH:mm:ss");
            string openStr = Bars.Open[0].ToString("F2", System.Globalization.CultureInfo.InvariantCulture);
            string highStr = Bars.High[0].ToString("F2", System.Globalization.CultureInfo.InvariantCulture);
            string lowStr = Bars.Low[0].ToString("F2", System.Globalization.CultureInfo.InvariantCulture);
            string closeStr = Bars.Close[0].ToString("F2", System.Globalization.CultureInfo.InvariantCulture);
            string emaStr = emaVal.ToString("F4", System.Globalization.CultureInfo.InvariantCulture);

            string barStr = string.Format(
                "{{\"time\":\"{0}\",\"open\":{1},\"high\":{2},\"low\":{3},\"close\":{4},\"ema\":{5}}}",
                timeStr, openStr, highStr, lowStr, closeStr, emaStr
            );
            m_barsJson.Add(barStr);

            // Write everything to file once we hit the last bar
            if (Bars.LastBarOnChart && !m_exported) {
                WriteJsonFile();
                m_exported = true;
            }
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
                Output.WriteLine("Renko data successfully exported to: " + fullPath);
            } catch (Exception ex) {
                // Log errors to MultiCharts Output Window
                Output.WriteLine("Export failed: " + ex.Message);
            }
        }
    }
}
