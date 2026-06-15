import os
import json
import argparse
from datetime import datetime

# Default configuration settings for the strategy
DEFAULT_CONFIG = {
    "ema_slope_period": 3,          # Number of bricks back to calculate EMA slope
    "ema_slope_threshold": 1.0,      # Minimum slope of the EMA (points change)
    "wick_retest_tolerance": 21.0,   # Max points the wick low/high can be from the EMA to be considered a 'touch'
    "max_ema_pierce": 1.75,         # Max points a wick can pierce past the EMA before it is considered broken
    "min_wick_length": 5.0,         # Minimum length of the rejection wick (tail) in points
    "max_ema_distance": 60.0,       # Maximum distance of brick close from EMA (prevents over-extended chase entries)
    "tick_size": 0.25,               # MNQ minimum price increment
    "tail_break_ticks": 2,           # Failure after price exceeds the signal tail by this many ticks
}

def load_json_data(file_path):
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Chart file not found: {file_path}")
    with open(file_path, 'r') as f:
        return json.load(f)

def load_annotations(annotations_path, file_key):
    if not os.path.exists(annotations_path):
        return []
    with open(annotations_path, 'r') as f:
        try:
            data = json.load(f)
            return data.get(file_key, [])
        except json.JSONDecodeError:
            return []

def run_strategy(data, config):
    trades = []
    signals = {} # timestamp -> "Buy" or "Sell"
    signal_details = [] # Exact bar identity for charts with duplicate timestamps
    signal_by_index = {}
    
    # Needs enough history to calculate EMA slope
    slope_period = config["ema_slope_period"]
    
    for i in range(max(slope_period, 4), len(data)):
        current = data[i]
        prev = data[i - slope_period]
        
        # Prices & Indicators
        o, h, l, c = current["open"], current["high"], current["low"], current["close"]
        ema = current["ema"]
        prev_ema = prev["ema"]
        
        if ema is None or prev_ema is None:
            continue
            
        ema_slope = ema - prev_ema
        is_up_brick = c > o
        is_down_brick = c < o
        
        # Immediate previous bar to check wick extensions
        prev_bar = data[i - 1]
        prev_o = prev_bar["open"]
        
        # 1. Check Bullish Setup (Long / Buy)
        # Trend Filter: EMA sloping upwards
        if ema_slope >= config["ema_slope_threshold"]:
            # Trigger: completed Blue (up) brick
            if is_up_brick:
                # Bottom Wick Length
                wick_length = o - l
                brick_size = abs(c - o)
                required_wick_length = min(config["min_wick_length"], brick_size)
                
                # Proximity of close to EMA
                body_dist = c - ema
                
                # Wicks may briefly test the EMA during a clean trend. Require
                # the previous three brick bodies, rather than their full
                # high/low ranges, to remain above the EMA.
                prev_3_above = (
                    min(data[i-1]["open"], data[i-1]["close"]) >= data[i-1]["ema"] and
                    min(data[i-2]["open"], data[i-2]["close"]) >= data[i-2]["ema"] and
                    min(data[i-3]["open"], data[i-3]["close"]) >= data[i-3]["ema"]
                )
                
                # New Rules:
                # - Tail goes back at least to the previous open (l <= prev_o)
                # - Tail may pierce slightly below the EMA, within max_ema_pierce
                # - Bars above the EMA for several consecutive bars (prev_3_above)
                if (wick_length >= required_wick_length and
                    l <= prev_o and
                    l >= ema - config["max_ema_pierce"] and
                    prev_3_above and
                    body_dist <= config["max_ema_distance"]):
                    signals[current["time"]] = "Buy"
                    signal_by_index[i] = "Buy"
                    signal_details.append({
                        "barIndex": i,
                        "timestamp": current["time"],
                        "action": "Buy",
                    })
                    
        # 2. Check Bearish Setup (Short / Sell)
        # Trend Filter: EMA sloping downwards
        elif ema_slope <= -config["ema_slope_threshold"]:
            # Trigger: completed Red (down) brick
            if is_down_brick:
                # Top Wick Length
                wick_length = h - o
                brick_size = abs(c - o)
                required_wick_length = min(config["min_wick_length"], brick_size)
                
                # Proximity of close to EMA
                body_dist = ema - c
                
                # Wicks may briefly test the EMA during a clean trend. Require
                # the previous three brick bodies, rather than their full
                # high/low ranges, to remain below the EMA.
                prev_3_below = (
                    max(data[i-1]["open"], data[i-1]["close"]) <= data[i-1]["ema"] and
                    max(data[i-2]["open"], data[i-2]["close"]) <= data[i-2]["ema"] and
                    max(data[i-3]["open"], data[i-3]["close"]) <= data[i-3]["ema"]
                )
                
                # New Rules:
                # - Tail goes back at least to the previous open (h >= prev_o)
                # - Tail may pierce slightly above the EMA, within max_ema_pierce
                # - Bars below the EMA for several consecutive bars (prev_3_below)
                if (wick_length >= required_wick_length and
                    h >= prev_o and
                    h <= ema + config["max_ema_pierce"] and
                    prev_3_below and
                    body_dist <= config["max_ema_distance"]):
                    signals[current["time"]] = "Sell"
                    signal_by_index[i] = "Sell"
                    signal_details.append({
                        "barIndex": i,
                        "timestamp": current["time"],
                        "action": "Sell",
                    })

    # Evaluate every signal independently: one favorable brick must complete
    # before price exceeds the signal bar's tail by two ticks.
    tail_break_distance = config["tick_size"] * config["tail_break_ticks"]
    for signal in signal_details:
        i = signal["barIndex"]
        signal_bar = data[i]
        direction = signal["action"]
        entry_price = signal_bar["close"]
        brick_size = abs(signal_bar["close"] - signal_bar["open"])

        evaluation = {
            "entry_time": signal_bar["time"],
            "barIndex": i,
            "direction": direction,
            "entry_price": entry_price,
            "brick_size": brick_size,
            "tail_break_distance": tail_break_distance,
            "result": "Pending",
        }

        if direction == "Buy":
            evaluation["success_price"] = entry_price + brick_size
            evaluation["failure_price"] = signal_bar["low"] - tail_break_distance
        else:
            evaluation["success_price"] = entry_price - brick_size
            evaluation["failure_price"] = signal_bar["high"] + tail_break_distance

        for j in range(i + 1, len(data)):
            future = data[j]
            if direction == "Buy":
                failed = future["low"] <= evaluation["failure_price"]
                succeeded = (
                    future["close"] > future["open"] and
                    future["close"] >= evaluation["success_price"]
                )
            else:
                failed = future["high"] >= evaluation["failure_price"]
                succeeded = (
                    future["close"] < future["open"] and
                    future["close"] <= evaluation["success_price"]
                )

            # OHLC data cannot establish intrabar ordering. If both thresholds
            # occur in one bar, count the tail break first conservatively.
            if failed:
                evaluation["result"] = "Fail"
                evaluation["outcome_reason"] = "Tail broken by two ticks"
                evaluation["outcome_time"] = future["time"]
                evaluation["outcome_barIndex"] = j
                break
            if succeeded:
                evaluation["result"] = "Pass"
                evaluation["outcome_reason"] = "One favorable brick completed"
                evaluation["outcome_time"] = future["time"]
                evaluation["outcome_barIndex"] = j
                break

        trades.append(evaluation)

    return signals, signal_details, trades

def analyze_alignment(signals, annotations, data):
    # Map raw data timestamp to bar details for easy retrieval
    data_map = {d["time"]: d for d in data}
    
    matches = []
    false_negatives = [] # User annotated, backtester missed
    false_positives = [] # Backtester triggered, user labeled Skip (or didn't label)
    
    # Check user annotations
    for ann in annotations:
        t = ann["timestamp"]
        user_action = ann["action"]
        system_action = signals.get(t)
        
        bar = data_map.get(t, {})
        ema_val = bar.get("ema")
        
        # Calculate slope at annotation timestamp
        slope = None
        try:
            idx = data.index(bar)
            if idx >= 3:
                slope = data[idx]["ema"] - data[idx - 3]["ema"]
        except Exception:
            pass
            
        metrics = {
            "timestamp": t,
            "user_action": user_action,
            "system_action": system_action,
            "close": bar.get("close"),
            "ema": ema_val,
            "slope": slope,
            "open": bar.get("open"),
            "high": bar.get("high"),
            "low": bar.get("low"),
            "comment": ann.get("comment", "")
        }

        if user_action in ["Buy", "Sell"]:
            if system_action == user_action:
                matches.append(metrics)
            else:
                false_negatives.append(metrics)
        elif user_action == "Skip":
            if system_action is not None:
                false_positives.append(metrics)

    return matches, false_negatives, false_positives

def print_report(chart_name, signals, evaluations, matches, false_negatives, false_positives, config):
    print("=" * 60)
    print(f" RENKO BACKTEST & ALIGNMENT REPORT: {chart_name}")
    print("=" * 60)
    
    # 1. Config parameters
    print("Math Settings Applied:")
    for k, v in config.items():
        print(f"  - {k}: {v}")
    print("-" * 60)

    # 2. Performance Summary
    passed = [item for item in evaluations if item["result"] == "Pass"]
    failed = [item for item in evaluations if item["result"] == "Fail"]
    pending = [item for item in evaluations if item["result"] == "Pending"]
    resolved = len(passed) + len(failed)
    pass_rate = (len(passed) / resolved * 100) if resolved > 0 else 0
    
    print("Signal Quality Performance:")
    print(f"  - Total Signals: {len(evaluations)}")
    print(f"  - Passed: {len(passed)} | Failed: {len(failed)} | Pending: {len(pending)}")
    print(f"  - Signal Pass Rate: {pass_rate:.2f}%")
    print("-" * 60)

    # 3. Alignment Summary
    print("AI Alignment with Your Eye:")
    total_labeled = len(matches) + len(false_negatives)
    alignment_rate = (len(matches) / total_labeled * 100) if total_labeled > 0 else 0
    
    print(f"  - Labeled Entries Matched: {len(matches)} / {total_labeled} ({alignment_rate:.2f}%)")
    print(f"  - False Negatives (Missed): {len(false_negatives)}")
    print(f"  - False Positives (Skipped): {len(false_positives)}")
    print("-" * 60)

    # 4. Discrepancy Breakdown
    if false_negatives:
        print("\n[!] False Negatives - Strategy missed these trades you marked:")
        for fn in false_negatives:
            print(f"  * Time: {fn['timestamp']}")
            print(f"    - Your label: {fn['user_action']}")
            print(f"    - Brick values: Open={fn['open']}, High={fn['high']}, Low={fn['low']}, Close={fn['close']}")
            print(f"    - EMA values:   EMA={fn['ema']:.2f}, Slope={fn['slope']:.2f} (threshold is {config['ema_slope_threshold']})")
            if fn['comment']:
                print(f"    - Your note:    \"{fn['comment']}\"")
            print()

    if false_positives:
        print("\n[!] False Positives - Strategy entered, but you labeled as skip:")
        for fp in false_positives:
            print(f"  * Time: {fp['timestamp']}")
            print(f"    - System entered: {fp['system_action']}")
            print(f"    - Brick values:  Open={fp['open']}, High={fp['high']}, Low={fp['low']}, Close={fp['close']}")
            print(f"    - EMA values:    EMA={fp['ema']:.2f}, Slope={fp['slope']:.2f}")
            if fp['comment']:
                print(f"    - Your note:     \"{fp['comment']}\"")
            print()
    print("=" * 60)

def run_optimization(data, annotations):
    if not annotations:
        return DEFAULT_CONFIG.copy()
        
    best_config = DEFAULT_CONFIG.copy()
    best_f1 = -1.0
    
    # Grid search parameters centered around typical values for 15pt Renko
    slope_thresholds = [1.0, 2.0, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0]
    wick_lengths = [5.0, 10.0, 15.0, 20.0, 25.0]
    max_ema_distances = [15.0, 20.0, 30.0, 40.0, 50.0, 60.0]
    retest_tolerances = [2.0, 5.0, 10.0, 15.0, 21.0, 25.0]
    
    for slope in slope_thresholds:
        for wick in wick_lengths:
            for dist in max_ema_distances:
                for tol in retest_tolerances:
                    cfg = DEFAULT_CONFIG.copy()
                    cfg["ema_slope_threshold"] = slope
                    cfg["min_wick_length"] = wick
                    cfg["max_ema_distance"] = dist
                    cfg["wick_retest_tolerance"] = tol
                    
                    signals, _, _ = run_strategy(data, cfg)
                    matches, false_negatives, false_positives = analyze_alignment(signals, annotations, data)
                    
                    tp = len(matches)
                    fn = len(false_negatives)
                    fp = len(false_positives)
                    
                    if tp == 0:
                        f1 = 0.0
                    else:
                        precision = tp / (tp + fp)
                        recall = tp / (tp + fn)
                        f1 = 2 * (precision * recall) / (precision + recall)
                        
                    # Choose configuration that maximizes F1 alignment score
                    if f1 > best_f1:
                        best_f1 = f1
                        best_config = cfg
                    elif f1 == best_f1 and f1 > 0:
                        # Tie-breaker: prefer smaller max_ema_distance to avoid chasing entries
                        if cfg["max_ema_distance"] < best_config["max_ema_distance"]:
                            best_config = cfg
                            
    return best_config

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Renko Strategy Backtester & Annotation Alignment Engine")
    parser.add_argument("--chart", required=True, help="Name of the chart file inside data/ (without .json)")
    
    # Allow overriding strategy config from CLI
    parser.add_argument("--slope-threshold", type=float, help="Override EMA slope threshold")
    parser.add_argument("--retest-tolerance", type=float, help="Override wick retest tolerance")
    parser.add_argument("--min-wick", type=float, help="Override minimum wick length")
    parser.add_argument("--max-ema-dist", type=float, help="Override maximum EMA distance (proximity)")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")
    parser.add_argument("--optimize", action="store_true", help="Run parameter optimization sweep")
    
    args = parser.parse_args()
 
    # Build active config
    config = DEFAULT_CONFIG.copy()
    if args.slope_threshold is not None:
        config["ema_slope_threshold"] = args.slope_threshold
    if args.retest_tolerance is not None:
        config["wick_retest_tolerance"] = args.retest_tolerance
    if args.min_wick is not None:
        config["min_wick_length"] = args.min_wick
    if args.max_ema_dist is not None:
        config["max_ema_distance"] = args.max_ema_dist

    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    chart_path = os.path.join(project_dir, "data", f"{args.chart}.json")
    annotations_path = os.path.join(project_dir, "data", "annotations.json")

    try:
        data = load_json_data(chart_path)
        annotations = load_annotations(annotations_path, args.chart)
        
        if args.optimize:
            best_config = run_optimization(data, annotations)
            print(json.dumps(best_config, indent=2))
            import sys
            sys.exit(0)
            
        signals, signal_details, signal_evaluations = run_strategy(data, config)
        matches, false_negatives, false_positives = analyze_alignment(signals, annotations, data)
        
        if args.json:
            result = {
                "signals": signals,
                "signal_details": signal_details,
                "signal_evaluations": signal_evaluations,
                "config": config,
                "alignment": {
                    "matches_count": len(matches),
                    "false_negatives_count": len(false_negatives),
                    "false_positives_count": len(false_positives)
                }
            }
            print(json.dumps(result, indent=2))
        else:
            print_report(
                args.chart,
                signals,
                signal_evaluations,
                matches,
                false_negatives,
                false_positives,
                config,
            )
        
    except Exception as e:
        import sys
        if args.json or args.optimize:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)
        else:
            print(f"Error: {e}")
            sys.exit(1)
