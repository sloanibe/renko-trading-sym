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
        }

        protected override void OnBarUpdate() {
            // Calculate 8 EMA on Close
            double emaVal = Functions.SeriesAverage(Bars.Close, EMAPeriod)[0];
            m_ema.Value = emaVal;

            // Formulate bar JSON string using InvariantCulture to ensure dot-separated decimals
            string barStr = string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "{{\"time\":\"{0}\",\"open\":{1:F2},\"high\":{2:F2},\"low\":{3:F2},\"close\":{4:F2},\"ema\":{5:F4}}}",
                Bars.Time[0].ToString("yyyy-MM-ddTHH:mm:ss"),
                Bars.Open[0], Bars.High[0], Bars.Low[0], Bars.Close[0], emaVal
            );
            m_barsJson.Add(barStr);

            // Write everything to file once we hit the last bar
            if (Bars.CurrentBar == Bars.Count) {
                WriteJsonFile();
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
