import os
import json
import argparse
from datetime import datetime

# Default configuration settings for the strategy
DEFAULT_CONFIG = {
    "ema_slope_period": 3,          # Number of bricks back to calculate EMA slope
    "ema_slope_threshold": 1.0,      # Minimum slope of the EMA (points change)
    "wick_retest_tolerance": 21.0,   # Max points the wick low/high can be from the EMA to be considered a 'touch'
    "max_ema_pierce": 1.5,          # Max points a wick can pierce past the EMA before it is considered broken
    "min_wick_length": 5.0,         # Minimum length of the rejection wick (tail) in points
    "max_ema_distance": 60.0,       # Maximum distance of brick close from EMA (prevents over-extended chase entries)
    "target_points": 45.0,           # Profit target in points
    "stop_loss_points": 15.0,        # Stop loss in points
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
    
    # Needs enough history to calculate EMA slope
    slope_period = config["ema_slope_period"]
    
    for i in range(slope_period, len(data)):
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
                
                # Proximity of close to EMA
                body_dist = c - ema
                
                # Check if EMA is within the wick range, with tolerance
                ema_below_top = ema <= o + config["wick_retest_tolerance"]
                ema_above_bottom = ema >= l - config["wick_retest_tolerance"]
                
                # Filter out wicks that pierced way too deep (broken trend)
                not_too_deep = (ema - l) <= config["max_ema_pierce"]
                
                if (wick_length >= config["min_wick_length"] and
                    l <= prev_o and
                    body_dist <= config["max_ema_distance"] and
                    ema_below_top and ema_above_bottom and not_too_deep):
                    signals[current["time"]] = "Buy"
                    
        # 2. Check Bearish Setup (Short / Sell)
        # Trend Filter: EMA sloping downwards
        elif ema_slope <= -config["ema_slope_threshold"]:
            # Trigger: completed Red (down) brick
            if is_down_brick:
                # Top Wick Length
                wick_length = h - o
                
                # Proximity of close to EMA
                body_dist = ema - c
                
                # Check if EMA is within the wick range, with tolerance
                ema_above_bottom = ema >= o - config["wick_retest_tolerance"]
                ema_below_top = ema <= h + config["wick_retest_tolerance"]
                
                # Filter out wicks that pierced way too deep (broken trend)
                not_too_deep = (h - ema) <= config["max_ema_pierce"]
                
                if (wick_length >= config["min_wick_length"] and
                    h >= prev_o and
                    body_dist <= config["max_ema_distance"] and
                    ema_above_bottom and ema_below_top and not_too_deep):
                    signals[current["time"]] = "Sell"

    # Simulate basic trade outcomes (Target / Stop Loss)
    active_trade = None
    for item in data:
        t = item["time"]
        c = item["close"]
        
        if active_trade:
            # Check exit
            entry_price = active_trade["entry_price"]
            direction = active_trade["direction"]
            
            if direction == "Buy":
                pnl = c - entry_price
                if pnl >= config["target_points"]:
                    active_trade["exit_price"] = entry_price + config["target_points"]
                    active_trade["exit_time"] = t
                    active_trade["result"] = "Win"
                    active_trade["pnl_points"] = config["target_points"]
                    trades.append(active_trade)
                    active_trade = None
                elif pnl <= -config["stop_loss_points"]:
                    active_trade["exit_price"] = entry_price - config["stop_loss_points"]
                    active_trade["exit_time"] = t
                    active_trade["result"] = "Loss"
                    active_trade["pnl_points"] = -config["stop_loss_points"]
                    trades.append(active_trade)
                    active_trade = None
            elif direction == "Sell":
                pnl = entry_price - c
                if pnl >= config["target_points"]:
                    active_trade["exit_price"] = entry_price - config["target_points"]
                    active_trade["exit_time"] = t
                    active_trade["result"] = "Win"
                    active_trade["pnl_points"] = config["target_points"]
                    trades.append(active_trade)
                    active_trade = None
                elif pnl <= -config["stop_loss_points"]:
                    active_trade["exit_price"] = entry_price + config["stop_loss_points"]
                    active_trade["exit_time"] = t
                    active_trade["result"] = "Loss"
                    active_trade["pnl_points"] = -config["stop_loss_points"]
                    trades.append(active_trade)
                    active_trade = None
        else:
            # Check entry
            if t in signals:
                active_trade = {
                    "entry_time": t,
                    "direction": signals[t],
                    "entry_price": c,
                }
                
    # If a trade is still open at the end, close it at market price
    if active_trade and len(data) > 0:
        last_close = data[-1]["close"]
        entry_price = active_trade["entry_price"]
        direction = active_trade["direction"]
        pnl = (last_close - entry_price) if direction == "Buy" else (entry_price - last_close)
        active_trade["exit_price"] = last_close
        active_trade["exit_time"] = data[-1]["time"]
        active_trade["result"] = "Win" if pnl >= 0 else "Loss"
        active_trade["pnl_points"] = pnl
        trades.append(active_trade)

    return signals, trades

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

def print_report(chart_name, signals, trades, matches, false_negatives, false_positives, config):
    print("=" * 60)
    print(f" RENKO BACKTEST & ALIGNMENT REPORT: {chart_name}")
    print("=" * 60)
    
    # 1. Config parameters
    print("Math Settings Applied:")
    for k, v in config.items():
        print(f"  - {k}: {v}")
    print("-" * 60)

    # 2. Performance Summary
    win_trades = [t for t in trades if t["result"] == "Win"]
    loss_trades = [t for t in trades if t["result"] == "Loss"]
    total_trades = len(trades)
    win_rate = (len(win_trades) / total_trades * 100) if total_trades > 0 else 0
    total_pnl = sum(t["pnl_points"] for t in trades)
    
    print("Strategy Performance:")
    print(f"  - Total Trades Triggered: {total_trades}")
    print(f"  - Wins: {len(win_trades)} | Losses: {len(loss_trades)}")
    print(f"  - Strategy Win Rate:     {win_rate:.2f}%")
    print(f"  - Total Strategy PnL:    {total_pnl:+.2f} points")
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
                    
                    signals, _ = run_strategy(data, cfg)
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
    parser.add_argument("--target", type=float, help="Override profit target points")
    parser.add_argument("--stop", type=float, help="Override stop loss points")
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
    if args.target is not None:
        config["target_points"] = args.target
    if args.stop is not None:
        config["stop_loss_points"] = args.stop

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
            
        signals, trades = run_strategy(data, config)
        matches, false_negatives, false_positives = analyze_alignment(signals, annotations, data)
        
        if args.json:
            result = {
                "signals": signals,
                "trades": trades,
                "config": config,
                "alignment": {
                    "matches_count": len(matches),
                    "false_negatives_count": len(false_negatives),
                    "false_positives_count": len(false_positives)
                }
            }
            print(json.dumps(result, indent=2))
        else:
            print_report(args.chart, signals, trades, matches, false_negatives, false_positives, config)
        
    except Exception as e:
        import sys
        if args.json or args.optimize:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)
        else:
            print(f"Error: {e}")
            sys.exit(1)
