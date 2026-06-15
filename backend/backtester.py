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
    "cooldown_bars": 0,             # Minimum number of bars to wait between signals (0 to disable)
    "wick_body_offset_ticks": 0,    # Ticks the wick must pierce beyond previous open (positive = deeper, negative = shallower)
    "start_time": "06:31:00",       # Skip the first minute after the session open
    "end_time": "11:00:00",         # End of daily trading window (PST)
    "arid_lookback": 8,
    "arid_max_overlap_bricks": 0.5,
    "arid_max_reversals": 1,
    "arid_ema_slope_period": 5,
    "arid_ema_slope_threshold": 4.0,
    "arid_min_ema_gap_bricks": 0.5,
    "set3_left_lookback": 8,
    "set3_max_left_overlaps": 1,
    "set3_ema_slope_period": 5,
    "set3_ema_slope_threshold": 4.0,
    "set3_min_ema_gap_bricks": 0.5,
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

def evaluate_signal_details(data, signal_details, config):
    evaluations = []
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

        evaluations.append(evaluation)

    return evaluations

def run_arid_strategy(data, config):
    signal_details = []
    lookback = max(3, config["arid_lookback"])
    slope_period = max(1, config["arid_ema_slope_period"])
    start_index = max(lookback - 1, slope_period)

    for i in range(start_index, len(data)):
        current = data[i]
        time_string = current["time"].split("T")[1].replace("Z", "")
        if not config["start_time"] <= time_string <= config["end_time"]:
            continue
        recent = data[i - lookback + 1:i + 1]
        brick_size = abs(current["close"] - current["open"])
        if brick_size == 0 or current.get("ema") is None:
            continue

        slope_ema = data[i - slope_period].get("ema")
        if slope_ema is None:
            continue
        ema_slope = current["ema"] - slope_ema

        directions = [
            1 if bar["close"] > bar["open"] else -1 if bar["close"] < bar["open"] else 0
            for bar in recent
        ]
        reversals = sum(
            previous != 0 and current_direction != 0 and previous != current_direction
            for previous, current_direction in zip(directions, directions[1:])
        )

        overlap_values = []
        for previous, bar in zip(recent, recent[1:]):
            overlap = max(0.0, min(previous["high"], bar["high"]) - max(previous["low"], bar["low"]))
            overlap_values.append(overlap / brick_size)
        average_overlap = sum(overlap_values) / len(overlap_values)
        ema_body_intersections = sum(
            min(bar["open"], bar["close"]) <= bar["ema"] <= max(bar["open"], bar["close"])
            for bar in recent
            if bar.get("ema") is not None
        )

        if (
            reversals > config["arid_max_reversals"] or
            average_overlap > config["arid_max_overlap_bricks"] or
            ema_body_intersections > 0
        ):
            continue

        o, h, l, c, ema = (
            current["open"],
            current["high"],
            current["low"],
            current["close"],
            current["ema"],
        )
        previous_bar = data[i - 1]
        required_wick = min(config["min_wick_length"], brick_size)
        minimum_gap = config["arid_min_ema_gap_bricks"] * brick_size
        metrics = {
            "emaSlope": ema_slope,
            "averageOverlapBricks": average_overlap,
            "reversals": reversals,
            "emaBodyIntersections": ema_body_intersections,
            "emaGapBricks": None,
        }

        if (
            c > o and
            ema_slope >= config["arid_ema_slope_threshold"] and
            o - l >= required_wick and
            l <= previous_bar["open"] and
            l - ema >= minimum_gap
        ):
            metrics["emaGapBricks"] = (l - ema) / brick_size
            signal_details.append({
                "barIndex": i,
                "timestamp": current["time"],
                "action": "Buy",
                "metrics": metrics,
            })
        elif (
            c < o and
            ema_slope <= -config["arid_ema_slope_threshold"] and
            h - o >= required_wick and
            h >= previous_bar["open"] and
            ema - h >= minimum_gap
        ):
            metrics["emaGapBricks"] = (ema - h) / brick_size
            signal_details.append({
                "barIndex": i,
                "timestamp": current["time"],
                "action": "Sell",
                "metrics": metrics,
            })

    return signal_details, evaluate_signal_details(data, signal_details, config)

def evaluate_set3_signals(data, signal_details):
    evaluations = []

    for signal in signal_details:
        entry_index = signal["barIndex"]
        entry_bar = data[entry_index]
        direction = signal["action"]
        entry_price = entry_bar["close"]
        brick_size = abs(entry_bar["close"] - entry_bar["open"])
        evaluation = {
            "entry_time": entry_bar["time"],
            "barIndex": entry_index,
            "direction": direction,
            "entry_price": entry_price,
            "brick_size": brick_size,
            "result": "Open",
        }

        for exit_index in range(entry_index + 1, len(data)):
            exit_bar = data[exit_index]
            is_opposing = (
                direction == "Buy" and exit_bar["close"] < exit_bar["open"]
            ) or (
                direction == "Sell" and exit_bar["close"] > exit_bar["open"]
            )
            if not is_opposing:
                continue

            raw_profit = (
                exit_bar["close"] - entry_price
                if direction == "Buy"
                else entry_price - exit_bar["close"]
            )
            profit_bricks = raw_profit / brick_size if brick_size else 0.0
            evaluation.update({
                "exit_time": exit_bar["time"],
                "exit_barIndex": exit_index,
                "exit_price": exit_bar["close"],
                "profit_bricks": profit_bricks,
                "result": "Win" if profit_bricks > 0 else "Loss" if profit_bricks < 0 else "BE",
                "outcome_reason": "First opposing brick closed",
            })
            break

        evaluations.append(evaluation)

    return evaluations

def run_no_tail_arity_strategy(data, config):
    signal_details = []
    if not data:
        return signal_details, []

    # Signal Set 3 is intentionally restricted to body-only Renko data.
    has_tails = any(
        bar["high"] > max(bar["open"], bar["close"]) or
        bar["low"] < min(bar["open"], bar["close"])
        for bar in data
    )
    if has_tails:
        return signal_details, []

    lookback = max(3, config["set3_left_lookback"])
    slope_period = max(1, config["set3_ema_slope_period"])
    start_index = max(lookback + 1, slope_period)

    for i in range(start_index, len(data)):
        current = data[i]
        pullback = data[i - 1]
        time_string = current["time"].split("T")[1].replace("Z", "")
        if not config["start_time"] <= time_string <= config["end_time"]:
            continue

        current_direction = 1 if current["close"] > current["open"] else -1
        pullback_direction = 1 if pullback["close"] > pullback["open"] else -1
        if current_direction == pullback_direction:
            continue

        brick_size = abs(current["close"] - current["open"])
        if brick_size == 0 or current.get("ema") is None or pullback.get("ema") is None:
            continue

        slope_base = data[i - slope_period].get("ema")
        if slope_base is None:
            continue
        ema_slope = current["ema"] - slope_base
        minimum_gap = config["set3_min_ema_gap_bricks"] * brick_size

        current_body_low = min(current["open"], current["close"])
        current_body_high = max(current["open"], current["close"])
        pullback_body_low = min(pullback["open"], pullback["close"])
        pullback_body_high = max(pullback["open"], pullback["close"])
        left_bars = data[i - lookback - 1:i - 1]
        left_overlaps = sum(
            min(max(bar["open"], bar["close"]), pullback_body_high) >
            max(min(bar["open"], bar["close"]), pullback_body_low)
            for bar in left_bars
        )
        if left_overlaps > config["set3_max_left_overlaps"]:
            continue

        if current_direction > 0:
            trend_is_strong = ema_slope >= config["set3_ema_slope_threshold"]
            setup_is_off_ema = current_body_low - current["ema"] >= minimum_gap
            action = "Buy"
        else:
            trend_is_strong = ema_slope <= -config["set3_ema_slope_threshold"]
            setup_is_off_ema = current["ema"] - current_body_high >= minimum_gap
            action = "Sell"

        if not trend_is_strong or not setup_is_off_ema:
            continue

        signal_details.append({
            "barIndex": i,
            "markerBarIndex": i - 1,
            "timestamp": current["time"],
            "markerTimestamp": pullback["time"],
            "action": action,
            "metrics": {
                "emaSlope": ema_slope,
                "emaGapBricks": (
                    current_body_low - current["ema"]
                    if current_direction > 0
                    else current["ema"] - current_body_high
                ) / brick_size,
                "leftOverlaps": left_overlaps,
                "leftLookback": lookback,
                "pullbackBarIndex": i - 1,
            },
        })

    return signal_details, evaluate_set3_signals(data, signal_details)

def run_strategy(data, config):
    trades = []
    signals = {} # timestamp -> "Buy" or "Sell"
    signal_details = [] # Exact bar identity for charts with duplicate timestamps
    signal_by_index = {}
    
    # (EMA 50 calculation removed)

    # Needs enough history to calculate EMA slope
    slope_period = config["ema_slope_period"]
    
    for i in range(max(slope_period, 4), len(data)):
        current = data[i]
        prev = data[i - slope_period]
        
        o, h, l, c = current["open"], current["high"], current["low"], current["close"]
        ema = current["ema"]
        prev_ema = prev["ema"]
        
        if ema is None or prev_ema is None:
            continue
            
        ema_slope = ema - prev_ema
        is_up_brick = c > o
        is_down_brick = c < o
        
        # Check pure time cool-down first
        cooldown = config.get("cooldown_bars", 10)
        if len(signal_details) > 0 and (i - signal_details[-1]["barIndex"]) < cooldown:
            continue
            
        # Immediate previous bar to check wick extensions
        prev_bar = data[i - 1]
        offset_distance = config.get("wick_body_offset_ticks", 0) * config.get("tick_size", 0.25)
        buy_tail_limit = prev_bar["open"] - offset_distance
        sell_tail_limit = prev_bar["open"] + offset_distance
        
        # Trend Filter: 8 EMA sloping upwards
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
                # - Tail goes back at least to the parameterized open offset (l <= buy_tail_limit)
                # - Tail may pierce slightly below the EMA, within max_ema_pierce
                # - Bars above the EMA for several consecutive bars (prev_3_above)
                if (wick_length >= required_wick_length and
                    l <= buy_tail_limit and
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
        # Trend Filter: 8 EMA sloping downwards
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
                # - Tail goes back at least to the parameterized open offset (h >= sell_tail_limit)
                # - Tail may pierce slightly above the EMA, within max_ema_pierce
                # - Bars below the EMA for several consecutive bars (prev_3_below)
                if (wick_length >= required_wick_length and
                    h >= sell_tail_limit and
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

def run_daily_campaign(data, signal_details, config, exit_strategy="fixed"):
    # Group bar indices by date YYYY-MM-DD
    date_to_bar_indices = {}
    for i, bar in enumerate(data):
        date_str = bar["time"].split("T")[0]
        if date_str not in date_to_bar_indices:
            date_to_bar_indices[date_str] = []
        date_to_bar_indices[date_str].append(i)

    # Group signals by date, filtering for start_time <= time <= end_time PST (local time)
    start_time = config.get("start_time", "06:31:00")
    end_time = config.get("end_time", "11:00:00")
    date_to_signals = {}
    for sig in signal_details:
        t = sig["timestamp"]
        date_str = t.split("T")[0]
        time_str = t.split("T")[1].replace("Z", "")
        if start_time <= time_str <= end_time:
            if date_str not in date_to_signals:
                date_to_signals[date_str] = []
            date_to_signals[date_str].append(sig)

    daily_reports = []
    
    # We sort dates chronologically
    sorted_dates = sorted(date_to_bar_indices.keys())
    
    for date_str in sorted_dates:
        day_signals = date_to_signals.get(date_str, [])
        if not day_signals:
            continue
            
        bar_indices = date_to_bar_indices[date_str]
        day_signals_by_index = {sig["barIndex"]: sig for sig in day_signals}
        
        daily_net_profit = 0.0
        has_lost_today = False
        active_trade = None
        trade_history = []
        done_for_the_day = False
        success_time = None
        
        # We assume the brick size is constant or can be derived from the first bar of the day
        first_bar = data[bar_indices[0]]
        brick_size = abs(first_bar["close"] - first_bar["open"])
        if brick_size == 0:
            brick_size = 3.75 # Fallback to standard MNQ 15-tick brick size in points
            
        for i in bar_indices:
            if done_for_the_day:
                break
                
            bar = data[i]
            was_in_position = active_trade is not None
            
            # Update active trade
            if active_trade is not None:
                direction = active_trade["direction"]
                entry_price = active_trade["entry_price"]
                stop_price = active_trade["stop_price"]
                target_price = active_trade["target_price"]
                be_triggered = active_trade["be_triggered"]
                
                if direction == "Buy":
                    # Check exits first
                    hit_stop = bar["low"] <= stop_price
                    
                    if exit_strategy == "trail":
                        is_opposite = bar["close"] < bar["open"]
                        if hit_stop:
                            if be_triggered:
                                daily_net_profit += 0.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                            else:
                                daily_net_profit -= 2.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif is_opposite:
                            pnl_points = bar["close"] - entry_price
                            pnl_bricks = round(pnl_points / brick_size, 1)
                            daily_net_profit += pnl_bricks
                            trade_history.append({
                                **active_trade,
                                "exit_time": bar["time"], "exit_barIndex": i,
                                "result": "Trail",
                                "profit_bricks": pnl_bricks
                            })
                            active_trade = None
                        else:
                            # Check if we trigger breakeven for the next bar
                            if bar["high"] >= entry_price + brick_size and not be_triggered:
                                active_trade["be_triggered"] = True
                                active_trade["stop_price"] = entry_price
                                be_triggered = True
                                stop_price = entry_price
                    elif exit_strategy == "stepup":
                        hit_target = bar["high"] >= target_price
                        if hit_stop and hit_target:
                            daily_net_profit -= 2.0
                            has_lost_today = True
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif hit_stop:
                            if has_lost_today and be_triggered:
                                daily_net_profit += 0.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                            else:
                                daily_net_profit -= 2.0
                                has_lost_today = True
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif hit_target:
                            win_bricks = 1.0 if not has_lost_today else 2.0
                            daily_net_profit += win_bricks
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Win", "profit_bricks": win_bricks})
                            active_trade = None
                        else:
                            # Check if we trigger breakeven (only after loss)
                            if has_lost_today:
                                if bar["high"] >= entry_price + brick_size and not be_triggered:
                                    active_trade["be_triggered"] = True
                                    active_trade["stop_price"] = entry_price
                                    be_triggered = True
                                    stop_price = entry_price
                    else:
                        hit_target = bar["high"] >= target_price
                        if hit_stop and hit_target:
                            if be_triggered:
                                daily_net_profit += 0.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                            else:
                                daily_net_profit -= 2.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif hit_stop:
                            if be_triggered:
                                daily_net_profit += 0.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                            else:
                                daily_net_profit -= 2.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif hit_target:
                            daily_net_profit += 2.0
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Win", "profit_bricks": 2.0})
                            active_trade = None
                        else:
                            # Check if we trigger breakeven for the next bar
                            if bar["high"] >= entry_price + brick_size and not be_triggered:
                                active_trade["be_triggered"] = True
                                active_trade["stop_price"] = entry_price
                                be_triggered = True
                                stop_price = entry_price
                else: # Sell
                    # Check exits first
                    hit_stop = bar["high"] >= stop_price
                    
                    if exit_strategy == "trail":
                        is_opposite = bar["close"] > bar["open"]
                        if hit_stop:
                            if be_triggered:
                                daily_net_profit += 0.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                            else:
                                daily_net_profit -= 2.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif is_opposite:
                            pnl_points = entry_price - bar["close"]
                            pnl_bricks = round(pnl_points / brick_size, 1)
                            daily_net_profit += pnl_bricks
                            trade_history.append({
                                **active_trade,
                                "exit_time": bar["time"], "exit_barIndex": i,
                                "result": "Trail",
                                "profit_bricks": pnl_bricks
                            })
                            active_trade = None
                        else:
                            # Check if we trigger breakeven for the next bar
                            if bar["low"] <= entry_price - brick_size and not be_triggered:
                                active_trade["be_triggered"] = True
                                active_trade["stop_price"] = entry_price
                                be_triggered = True
                                stop_price = entry_price
                    elif exit_strategy == "stepup":
                        hit_target = bar["low"] <= target_price
                        if hit_stop and hit_target:
                            daily_net_profit -= 2.0
                            has_lost_today = True
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif hit_stop:
                            if has_lost_today and be_triggered:
                                daily_net_profit += 0.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                            else:
                                daily_net_profit -= 2.0
                                has_lost_today = True
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif hit_target:
                            win_bricks = 1.0 if not has_lost_today else 2.0
                            daily_net_profit += win_bricks
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Win", "profit_bricks": win_bricks})
                            active_trade = None
                        else:
                            # Check if we trigger breakeven (only after loss)
                            if has_lost_today:
                                if bar["low"] <= entry_price - brick_size and not be_triggered:
                                    active_trade["be_triggered"] = True
                                    active_trade["stop_price"] = entry_price
                                    be_triggered = True
                                    stop_price = entry_price
                    else:
                        hit_target = bar["low"] <= target_price
                        if hit_stop and hit_target:
                            if be_triggered:
                                daily_net_profit += 0.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                            else:
                                daily_net_profit -= 2.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif hit_stop:
                            if be_triggered:
                                daily_net_profit += 0.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                            else:
                                daily_net_profit -= 2.0
                                trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -2.0})
                            active_trade = None
                        elif hit_target:
                            daily_net_profit += 2.0
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Win", "profit_bricks": 2.0})
                            active_trade = None
                        else:
                            # Check if we trigger breakeven for the next bar
                            if bar["low"] <= entry_price - brick_size and not be_triggered:
                                active_trade["be_triggered"] = True
                                active_trade["stop_price"] = entry_price
                                be_triggered = True
                                stop_price = entry_price
                            
                # Check target hit
                if daily_net_profit >= 2.0:
                    done_for_the_day = True
                    success_time = bar["time"]
                    break
            
            # A signal that completes while a position is open is ignored,
            # including a signal on the same bar that closes the position.
            if not was_in_position and active_trade is None and not done_for_the_day:
                if i in day_signals_by_index:
                    sig = day_signals_by_index[i]
                    direction = sig["action"]
                    entry_price = bar["close"]
                    
                    if exit_strategy == "trail":
                        stop_price = entry_price - 2.0 * brick_size if direction == "Buy" else entry_price + 2.0 * brick_size
                        target_price = 999999999.0 if direction == "Buy" else -999999999.0
                    elif exit_strategy == "stepup" and not has_lost_today:
                        stop_price = entry_price - 2.0 * brick_size if direction == "Buy" else entry_price + 2.0 * brick_size
                        target_price = entry_price + 1.0 * brick_size if direction == "Buy" else entry_price - 1.0 * brick_size
                    else:
                        stop_price = entry_price - 2.0 * brick_size if direction == "Buy" else entry_price + 2.0 * brick_size
                        target_price = entry_price + 2.0 * brick_size if direction == "Buy" else entry_price - 2.0 * brick_size
                        
                    active_trade = {
                        "entry_time": bar["time"],
                        "entry_barIndex": i,
                        "direction": direction,
                        "entry_price": entry_price,
                        "stop_price": stop_price,
                        "target_price": target_price,
                        "be_triggered": False,
                    }
                    
        # Close open positions at the end of the day session
        if active_trade is not None and not done_for_the_day:
            last_i = bar_indices[-1]
            last_bar = data[last_i]
            close_price = last_bar["close"]
            direction = active_trade["direction"]
            entry_price = active_trade["entry_price"]
            
            if direction == "Buy":
                pnl_points = close_price - entry_price
            else:
                pnl_points = entry_price - close_price
                
            pnl_bricks = pnl_points / brick_size
            daily_net_profit += pnl_bricks
            
            trade_history.append({
                **active_trade,
                "exit_time": last_bar["time"], "exit_barIndex": last_i,
                "result": "EndSession",
                "profit_bricks": pnl_bricks
            })
            active_trade = None

        daily_reports.append({
            "date": date_str,
            "net_profit_bricks": daily_net_profit,
            "result": "Win" if daily_net_profit >= 2.0 else "Loss/Flat",
            "success_time": success_time,
            "trades_count": len(trade_history),
            "trades": trade_history
        })
        
    # Calculate global campaign statistics
    total_days = len(daily_reports)
    winning_days = len([d for d in daily_reports if d["result"] == "Win"])
    losing_days = total_days - winning_days
    win_rate = (winning_days / total_days * 100) if total_days > 0 else 0.0
    
    # Calculate average time to success (in minutes from 06:30 AM PST)
    success_times_min = []
    for d in daily_reports:
        if d["result"] == "Win" and d["success_time"]:
            time_part = d["success_time"].split("T")[1].replace("Z", "")
            h, m, s = map(int, time_part.split(":"))
            total_minutes = h * 60 + m
            success_times_min.append(total_minutes)
            
    avg_success_time_str = "N/A"
    if success_times_min:
        avg_minutes = sum(success_times_min) / len(success_times_min)
        avg_h = int(avg_minutes // 60)
        avg_m = int(avg_minutes % 60)
        avg_success_time_str = f"{avg_h:02d}:{avg_m:02d} PST"
        
    max_drawdown = 0.0
    for d in daily_reports:
        running_pnl = 0.0
        for t in d["trades"]:
            running_pnl += t.get("profit_bricks", 0.0)
            if running_pnl < max_drawdown:
                max_drawdown = running_pnl
            
    return {
        "daily_reports": daily_reports,
        "exit_strategy": exit_strategy,
        "summary": {
            "total_days": total_days,
            "winning_days": winning_days,
            "losing_days": losing_days,
            "win_rate": win_rate,
            "avg_success_time": avg_success_time_str,
            "max_drawdown_bricks": max_drawdown
        }
    }

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

def print_report(chart_name, signals, evaluations, matches, false_negatives, false_positives, config, campaign_results=None):
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
    print("-" * 60)

    if campaign_results:
        summary = campaign_results["summary"]
        print("Daily Session Campaign (Option B):")
        print(f"  - Exit Strategy Mode: {campaign_results.get('exit_strategy', 'fixed').upper()}")
        print(f"  - Total Trading Days: {summary['total_days']}")
        print(f"  - Winning Days (+2 bricks target): {summary['winning_days']} ({summary['win_rate']:.2f}%)")
        print(f"  - Losing/Flat Days: {summary['losing_days']}")
        print(f"  - Average Time to Success: {summary['avg_success_time']}")
        print(f"  - Max Daily Drawdown: {summary['max_drawdown_bricks']:.2f} bricks")
    
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
    parser.add_argument("--cooldown-bars", type=int, help="Override time cool-down in bars")
    parser.add_argument("--wick-body-offset", type=int, help="Override wick body open offset in ticks (positive=deeper, negative=shallower)")
    parser.add_argument("--exit-strategy", choices=["fixed", "trail", "stepup"], default="fixed", help="Exit strategy for daily campaign ('fixed' target, 'trail' to opposite brick, or 'stepup' on loss)")
    parser.add_argument("--start-time", default="06:31:00", help="Start time of daily trading session (PST, HH:MM:SS)")
    parser.add_argument("--end-time", default="11:00:00", help="End time of daily trading session (PST, HH:MM:SS)")
    parser.add_argument("--arid-lookback", type=int, help="Signal Set 2 lookback in bricks")
    parser.add_argument("--arid-max-overlap", type=float, help="Signal Set 2 maximum average wick overlap in bricks")
    parser.add_argument("--arid-max-reversals", type=int, help="Signal Set 2 maximum direction reversals in the lookback")
    parser.add_argument("--arid-slope-threshold", type=float, help="Signal Set 2 minimum EMA change over its slope period")
    parser.add_argument("--arid-min-gap", type=float, help="Signal Set 2 minimum full-wick distance from EMA in bricks")
    parser.add_argument("--set3-left-lookback", type=int, help="Signal Set 3 bars inspected for left-side congestion")
    parser.add_argument("--set3-max-left-overlaps", type=int, help="Signal Set 3 maximum older bodies overlapping the setup")
    parser.add_argument("--set3-slope-threshold", type=float, help="Signal Set 3 minimum EMA change over its slope period")
    parser.add_argument("--set3-min-gap", type=float, help="Signal Set 3 minimum body distance from EMA in bricks")
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
    if args.cooldown_bars is not None:
        config["cooldown_bars"] = args.cooldown_bars
    if args.wick_body_offset is not None:
        config["wick_body_offset_ticks"] = args.wick_body_offset
    if args.start_time is not None:
        config["start_time"] = args.start_time
    if args.end_time is not None:
        config["end_time"] = args.end_time
    if args.arid_lookback is not None:
        config["arid_lookback"] = args.arid_lookback
    if args.arid_max_overlap is not None:
        config["arid_max_overlap_bricks"] = args.arid_max_overlap
    if args.arid_max_reversals is not None:
        config["arid_max_reversals"] = args.arid_max_reversals
    if args.arid_slope_threshold is not None:
        config["arid_ema_slope_threshold"] = args.arid_slope_threshold
    if args.arid_min_gap is not None:
        config["arid_min_ema_gap_bricks"] = args.arid_min_gap
    if args.set3_left_lookback is not None:
        config["set3_left_lookback"] = args.set3_left_lookback
    if args.set3_max_left_overlaps is not None:
        config["set3_max_left_overlaps"] = args.set3_max_left_overlaps
    if args.set3_slope_threshold is not None:
        config["set3_ema_slope_threshold"] = args.set3_slope_threshold
    if args.set3_min_gap is not None:
        config["set3_min_ema_gap_bricks"] = args.set3_min_gap

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
        signal_set_2_details, signal_set_2_evaluations = run_arid_strategy(data, config)
        signal_set_3_details, signal_set_3_evaluations = run_no_tail_arity_strategy(data, config)
        matches, false_negatives, false_positives = analyze_alignment(signals, annotations, data)
        campaign_results = run_daily_campaign(data, signal_details, config, exit_strategy=args.exit_strategy)
        
        if args.json:
            result = {
                "signals": signals,
                "signal_details": signal_details,
                "signal_evaluations": signal_evaluations,
                "signal_set_2_details": signal_set_2_details,
                "signal_set_2_evaluations": signal_set_2_evaluations,
                "signal_set_3_details": signal_set_3_details,
                "signal_set_3_evaluations": signal_set_3_evaluations,
                "campaign_results": campaign_results,
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
                campaign_results
            )
        
    except Exception as e:
        import sys
        if args.json or args.optimize:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)
        else:
            print(f"Error: {e}")
            sys.exit(1)
