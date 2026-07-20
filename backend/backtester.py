import os
import json
import argparse
from datetime import datetime
from itertools import product

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
    "mes3_ema_slope_period": 8,
    "mes3_ema_slope_threshold": 2.2,
    "mes3_short_slope_period": 3,
    "mes3_short_slope_threshold": 0.7,
    "mes3_min_tail": 0.75,
    "mes3_min_close_ema_distance": 1.0,
    "mes3_arity_lookback": 8,
    "mes3_max_overlap": 1.0,
    "mes3_max_reversals": 4,
    "mes3_cooldown_bars": 3,
    "mes3_prev_tail_slope_period": 8,
    "mes3_prev_tail_slope_threshold": 2.5,
    "mes3_prev_tail_short_slope_period": 3,
    "mes3_prev_tail_short_slope_threshold": 0.9,
    "mes3_prev_tail_min_tail": 0.75,
    "mes3_prev_tail_extension_ticks": 1,
    "mes3_prev_tail_min_close_ema_distance": 1.0,
    "mes3_prev_tail_arity_lookback": 8,
    "mes3_prev_tail_max_overlap": 1.0,
    "mes3_prev_tail_max_reversals": 4,
    "mes3_prev_tail_cooldown_bars": 3,
    "mes3_ha_ema_approach_slope_period": 8,
    "mes3_ha_ema_approach_slope_threshold": 1.25,
    "mes3_ha_ema_approach_ticks": 4,
    "mes3_ha_ema_approach_min_tail": 0.25,
    "mes3_ha_indecision_min_bars": 2,
    "mes3_ha_indecision_body_ratio": 0.45,
    "mes3_ha_breakout_body_ratio": 0.45,
    "mes3_ha_ema_approach_pre_seconds": 20,
    "mes3_ha_ema_approach_post_seconds": 12,
    "mes3_ha_ema_approach_cooldown_bars": 1,
    "mes3_ha_ema_approach_pullback_ticks": 0,
    "mes_reg5_long_tail_slope_period": 8,
    "mes_reg5_long_tail_slope_threshold": 0.20,
    "mes_reg5_long_tail_min_tail": 0.75,
    "mes_reg5_long_tail_min_close_distance": 1.0,
    "mes_reg5_long_tail_cooldown_bars": 3,
    "mes_reg5_ema_bounce_arity_slope_period": 8,
    "mes_reg5_ema_bounce_arity_slope_threshold": 0.22,
    "mes_reg5_ema_bounce_arity_short_slope_period": 4,
    "mes_reg5_ema_bounce_arity_short_slope_threshold": 0.36,
    "mes_reg5_ema_bounce_arity_relaxed_short_slope_threshold": 0.25,
    "mes_reg5_ema_bounce_arity_strong_short_slope_threshold": 0.38,
    "mes_reg5_ema_bounce_arity_strong_slope_threshold": 0.28,
    "mes_reg5_ema_bounce_arity_extended_short_slope_threshold": 0.36,
    "mes_reg5_ema_bounce_arity_lookback": 8,
    "mes_reg5_ema_bounce_arity_base_max_reversals": 3,
    "mes_reg5_ema_bounce_arity_strong_max_reversals": 5,
    "mes_reg5_ema_bounce_arity_base_max_overlap": 0.68,
    "mes_reg5_ema_bounce_arity_strong_max_overlap": 0.86,
    "mes_reg5_ema_bounce_arity_buy_low_to_ema_max": 0.30,
    "mes_reg5_ema_bounce_arity_sell_high_to_ema_min": 0.00,
    "mes_reg5_ema_bounce_arity_extended_buy_low_to_ema_max": 0.65,
    "mes_reg5_ema_bounce_arity_extended_sell_high_to_ema_min": 0.00,
    "mes_reg5_ema_bounce_arity_extended_min_tail": 0.75,
    "mes_reg5_ema_bounce_arity_pin_short_slope_threshold": 0.70,
    "mes_reg5_ema_bounce_arity_pin_slope_threshold": 0.55,
    "mes_reg5_ema_bounce_arity_pin_min_tail": 1.00,
    "mes_reg5_ema_bounce_arity_pin_min_ema_distance": 1.00,
    "mes_reg5_ema_bounce_arity_pin_max_ema_distance": 1.60,
    "mes_reg5_ema_bounce_arity_pin_max_overlap": 0.50,
    "mes_reg5_ema_bounce_arity_pin_max_reversals": 2,
    "mes_reg5_ema_bounce_arity_max_chase_distance": 1.25,
    "mes_reg5_ema_bounce_arity_min_close_dist_buy": 0.40,
    "mes_reg5_ema_bounce_arity_min_close_dist_sell": 0.72,
    "mes_reg5_ema_bounce_arity_cooldown_bars": 2,
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

def get_fast_ema(bar):
    return bar.get("ema5", bar.get("ema"))

def get_slow_ema(bar):
    fast_ema = get_fast_ema(bar)
    return bar.get("ema10", fast_ema)

def calculate_arity_metrics(data, index, lookback):
    recent = data[max(0, index - lookback + 1):index + 1]
    if len(recent) < 2:
        return 0.0, 0

    body_sizes = [
        abs(bar["close"] - bar["open"])
        for bar in recent
        if abs(bar["close"] - bar["open"]) > 0
    ]
    reference_body = sum(body_sizes) / len(body_sizes) if body_sizes else 1.0

    overlap_values = []
    for previous, current in zip(recent, recent[1:]):
        overlap = max(
            0.0,
            min(previous["high"], current["high"]) - max(previous["low"], current["low"])
        )
        overlap_values.append(overlap / reference_body if reference_body else 0.0)

    directions = [
        1 if bar["close"] > bar["open"] else -1 if bar["close"] < bar["open"] else 0
        for bar in recent
    ]
    reversals = sum(
        previous != 0 and current != 0 and previous != current
        for previous, current in zip(directions, directions[1:])
    )

    average_overlap = sum(overlap_values) / len(overlap_values) if overlap_values else 0.0
    return average_overlap, reversals

def run_mes3_trend_tail_strategy(data, config):
    signal_details = []
    slope_period = max(1, config.get("mes3_ema_slope_period", 8))
    slope_threshold = config.get("mes3_ema_slope_threshold", 2.2)
    short_slope_period = max(1, config.get("mes3_short_slope_period", 3))
    short_slope_threshold = config.get("mes3_short_slope_threshold", 0.7)
    min_tail = config.get("mes3_min_tail", 0.75)
    min_close_distance = config.get("mes3_min_close_ema_distance", 1.0)
    arity_lookback = max(2, config.get("mes3_arity_lookback", 8))
    max_overlap = config.get("mes3_max_overlap", 1.0)
    max_reversals = config.get("mes3_max_reversals", 4)
    cooldown_bars = max(0, config.get("mes3_cooldown_bars", 3))
    start_index = max(slope_period, short_slope_period, arity_lookback - 1)
    last_signal_index = -999999

    for i in range(start_index, len(data)):
        if i - last_signal_index <= cooldown_bars:
            continue

        current = data[i]
        ema = current.get("ema")
        previous_ema = data[i - slope_period].get("ema")
        short_previous_ema = data[i - short_slope_period].get("ema")
        if None in (ema, previous_ema, short_previous_ema):
            continue

        average_overlap, reversals = calculate_arity_metrics(data, i, arity_lookback)
        if average_overlap > max_overlap or reversals > max_reversals:
            continue

        o, h, l, c = current["open"], current["high"], current["low"], current["close"]
        is_up = c > o
        is_down = c < o
        lower_tail = min(o, c) - l
        upper_tail = h - max(o, c)
        ema_slope = ema - previous_ema
        short_ema_slope = ema - short_previous_ema
        close_to_ema = c - ema

        action = None
        if (
            is_up and
            ema_slope >= slope_threshold and
            short_ema_slope >= short_slope_threshold and
            lower_tail >= min_tail and
            close_to_ema >= min_close_distance
        ):
            action = "Buy"
        elif (
            is_down and
            ema_slope <= -slope_threshold and
            short_ema_slope <= -short_slope_threshold and
            upper_tail >= min_tail and
            -close_to_ema >= min_close_distance
        ):
            action = "Sell"

        if not action:
            continue

        signal_details.append({
            "barIndex": i,
            "timestamp": current["time"],
            "action": action,
            "metrics": {
                "setupType": "mes3TrendTail",
                "ema": ema,
                "emaSlope": ema_slope,
                "shortEmaSlope": short_ema_slope,
                "upperTail": upper_tail,
                "lowerTail": lower_tail,
                "closeToEma": close_to_ema,
                "averageOverlapBricks": average_overlap,
                "reversals": reversals,
            },
        })
        last_signal_index = i

    return signal_details, evaluate_signal_details(data, signal_details, config)

def run_mes3_previous_tail_rejection_strategy(data, config):
    signal_details = []
    tick_size = infer_price_increment(data)
    slope_period = max(1, config.get("mes3_prev_tail_slope_period", 8))
    slope_threshold = config.get("mes3_prev_tail_slope_threshold", 2.5)
    short_slope_period = max(1, config.get("mes3_prev_tail_short_slope_period", 3))
    short_slope_threshold = config.get("mes3_prev_tail_short_slope_threshold", 0.9)
    min_tail = config.get("mes3_prev_tail_min_tail", 0.75)
    extension_ticks = config.get("mes3_prev_tail_extension_ticks", 1)
    min_extension = tick_size * extension_ticks
    min_close_distance = config.get("mes3_prev_tail_min_close_ema_distance", 1.0)
    arity_lookback = max(2, config.get("mes3_prev_tail_arity_lookback", 8))
    max_overlap = config.get("mes3_prev_tail_max_overlap", 1.0)
    max_reversals = config.get("mes3_prev_tail_max_reversals", 4)
    cooldown_bars = max(0, config.get("mes3_prev_tail_cooldown_bars", 3))
    start_index = max(slope_period, short_slope_period, arity_lookback - 1, 1)
    last_signal_index = -999999

    for i in range(start_index, len(data)):
        if i - last_signal_index <= cooldown_bars:
            continue

        current = data[i]
        previous = data[i - 1]
        ema = current.get("ema")
        previous_ema = data[i - slope_period].get("ema")
        short_previous_ema = data[i - short_slope_period].get("ema")
        if None in (ema, previous_ema, short_previous_ema):
            continue

        average_overlap, reversals = calculate_arity_metrics(data, i, arity_lookback)
        if average_overlap > max_overlap or reversals > max_reversals:
            continue

        o, h, l, c = current["open"], current["high"], current["low"], current["close"]
        is_up = c > o
        is_down = c < o
        lower_tail = min(o, c) - l
        upper_tail = h - max(o, c)
        lower_extension = previous["low"] - l
        upper_extension = h - previous["high"]
        ema_slope = ema - previous_ema
        short_ema_slope = ema - short_previous_ema
        close_to_ema = c - ema

        action = None
        if (
            is_up and
            ema_slope >= slope_threshold and
            short_ema_slope >= short_slope_threshold and
            lower_tail >= min_tail and
            lower_extension >= min_extension and
            close_to_ema >= min_close_distance
        ):
            action = "Buy"
        elif (
            is_down and
            ema_slope <= -slope_threshold and
            short_ema_slope <= -short_slope_threshold and
            upper_tail >= min_tail and
            upper_extension >= min_extension and
            -close_to_ema >= min_close_distance
        ):
            action = "Sell"

        if not action:
            continue

        signal_details.append({
            "barIndex": i,
            "timestamp": current["time"],
            "action": action,
            "metrics": {
                "setupType": "mes3PreviousTailRejection",
                "ema": ema,
                "emaSlope": ema_slope,
                "shortEmaSlope": short_ema_slope,
                "upperTail": upper_tail,
                "lowerTail": lower_tail,
                "upperExtension": upper_extension,
                "lowerExtension": lower_extension,
                "closeToEma": close_to_ema,
                "averageOverlapBricks": average_overlap,
                "reversals": reversals,
                "tickSize": tick_size,
                "minExtension": min_extension,
            },
        })
        last_signal_index = i

    return signal_details, evaluate_signal_details(data, signal_details, config)

def run_mes_reg5_long_tail_strategy(data, config):
    signal_details = []
    slope_period = max(1, config.get("mes_reg5_long_tail_slope_period", 8))
    slope_threshold = config.get("mes_reg5_long_tail_slope_threshold", 0.20)
    min_tail = config.get("mes_reg5_long_tail_min_tail", 0.75)
    min_close_distance = config.get("mes_reg5_long_tail_min_close_distance", 1.0)
    cooldown_bars = max(0, config.get("mes_reg5_long_tail_cooldown_bars", 3))
    last_signal_index = -999999

    for i in range(slope_period, len(data)):
        if i - last_signal_index <= cooldown_bars:
            continue

        current = data[i]
        ema = current.get("ema")
        prev_ema = data[i - slope_period].get("ema")
        if None in (ema, prev_ema):
            continue

        o, h, l, c = current["open"], current["high"], current["low"], current["close"]
        is_up = c > o
        is_down = c < o
        lower_tail = min(o, c) - l
        upper_tail = h - max(o, c)
        ema_slope = (ema - prev_ema) / slope_period
        close_to_ema = c - ema

        action = None
        if (
            is_up and
            lower_tail >= min_tail and
            upper_tail == 0.0 and
            ema_slope >= slope_threshold and
            close_to_ema >= min_close_distance
        ):
            action = "Buy"
        elif (
            is_down and
            upper_tail >= min_tail and
            lower_tail == 0.0 and
            ema_slope <= -slope_threshold and
            -close_to_ema >= min_close_distance
        ):
            action = "Sell"

        if not action:
            continue

        signal_details.append({
            "barIndex": i,
            "timestamp": current["time"],
            "action": action,
            "metrics": {
                "setupType": "mesReg5LongTail",
                "ema": ema,
                "emaSlope": ema_slope,
                "upperTail": upper_tail,
                "lowerTail": lower_tail,
                "closeToEma": close_to_ema,
            },
        })
        last_signal_index = i

    return signal_details, evaluate_signal_details(data, signal_details, config)

def run_mes_reg5_ema_bounce_arity_strategy(data, config):
    signal_details = []

    # Calculate scale relative to baseline MESM_reg_5 range size (1.25 points)
    range_size = infer_range_size(data)
    scale = range_size / 1.25

    slope_period = max(1, config.get("mes_reg5_ema_bounce_arity_slope_period", 8))
    short_slope_period = max(1, config.get("mes_reg5_ema_bounce_arity_short_slope_period", 4))
    slope_threshold = config.get("mes_reg5_ema_bounce_arity_slope_threshold", 0.20) * scale
    short_slope_threshold = config.get("mes_reg5_ema_bounce_arity_short_slope_threshold", 0.28) * scale
    relaxed_short_slope_threshold = config.get("mes_reg5_ema_bounce_arity_relaxed_short_slope_threshold", 0.18) * scale
    strong_short_slope_threshold = config.get("mes_reg5_ema_bounce_arity_strong_short_slope_threshold", 0.30) * scale
    strong_slope_threshold = config.get("mes_reg5_ema_bounce_arity_strong_slope_threshold", 0.22) * scale
    extended_short_slope_threshold = config.get("mes_reg5_ema_bounce_arity_extended_short_slope_threshold", 0.36) * scale
    lookback = max(2, config.get("mes_reg5_ema_bounce_arity_lookback", 8))
    base_max_reversals = config.get("mes_reg5_ema_bounce_arity_base_max_reversals", 4)
    strong_max_reversals = config.get("mes_reg5_ema_bounce_arity_strong_max_reversals", base_max_reversals + 1)
    base_max_overlap = config.get("mes_reg5_ema_bounce_arity_base_max_overlap", 0.72)
    strong_max_overlap = config.get("mes_reg5_ema_bounce_arity_strong_max_overlap", 0.88)
    buy_low_to_ema_max = config.get("mes_reg5_ema_bounce_arity_buy_low_to_ema_max", 0.65) * scale
    sell_high_to_ema_min = config.get("mes_reg5_ema_bounce_arity_sell_high_to_ema_min", -1.10) * scale
    extended_buy_low_to_ema_max = config.get("mes_reg5_ema_bounce_arity_extended_buy_low_to_ema_max", buy_low_to_ema_max)
    extended_sell_high_to_ema_min = config.get("mes_reg5_ema_bounce_arity_extended_sell_high_to_ema_min", sell_high_to_ema_min)
    extended_min_tail = config.get("mes_reg5_ema_bounce_arity_extended_min_tail", 0.75) * scale
    pin_short_slope_threshold = config.get("mes_reg5_ema_bounce_arity_pin_short_slope_threshold", 0.70) * scale
    pin_slope_threshold = config.get("mes_reg5_ema_bounce_arity_pin_slope_threshold", 0.55) * scale
    pin_min_tail = config.get("mes_reg5_ema_bounce_arity_pin_min_tail", 1.00) * scale
    pin_min_ema_distance = config.get("mes_reg5_ema_bounce_arity_pin_min_ema_distance", 1.00) * scale
    pin_max_ema_distance = config.get("mes_reg5_ema_bounce_arity_pin_max_ema_distance", 1.60) * scale
    pin_max_overlap = config.get("mes_reg5_ema_bounce_arity_pin_max_overlap", 0.50)
    pin_max_reversals = config.get("mes_reg5_ema_bounce_arity_pin_max_reversals", 2)
    max_chase_distance = config.get("mes_reg5_ema_bounce_arity_max_chase_distance", 1.25) * scale
    min_close_dist_buy = config.get("mes_reg5_ema_bounce_arity_min_close_dist_buy", 0.50) * scale
    min_close_dist_sell = config.get("mes_reg5_ema_bounce_arity_min_close_dist_sell", 1.00) * scale
    cooldown_bars = max(0, config.get("mes_reg5_ema_bounce_arity_cooldown_bars", 3))
    last_signal_index = -999999

    start_index = max(slope_period, short_slope_period, lookback - 1)

    def body_range(bar):
        return min(bar["open"], bar["close"]), max(bar["open"], bar["close"])

    def overlap_length(first, second):
        return max(0.0, min(first[1], second[1]) - max(first[0], second[0]))

    def calculate_left_body_wall(index, wall_lookback=6, min_body=0.75 * scale, zone_pad=0.25 * scale):
        current_bar = data[index]
        current_body = body_range(current_bar)
        current_ema = current_bar.get("ema")
        zone_low = min(current_body[0], current_ema if current_ema is not None else current_body[0]) - zone_pad
        zone_high = max(current_body[1], current_ema if current_ema is not None else current_body[1]) + zone_pad
        zone = (zone_low, zone_high)
        count = 0
        body_sum = 0.0
        shelf_lows = []
        shelf_highs = []

        for left_index in range(max(0, index - wall_lookback), index):
            left_bar = data[left_index]
            left_body = body_range(left_bar)
            body_size = left_body[1] - left_body[0]
            if body_size < min_body:
                continue
            overlap = overlap_length(zone, left_body)
            overlap_ratio = overlap / body_size if body_size else 0.0
            if overlap_ratio < 0.45:
                continue
            count += 1
            body_sum += body_size
            shelf_lows.append(left_body[0])
            shelf_highs.append(left_body[1])

        shelf_span = max(shelf_highs) - min(shelf_lows) if shelf_highs else 0.0
        return {
            "count": count,
            "bodySum": body_sum,
            "shelfSpan": shelf_span,
        }

    for i in range(start_index, len(data)):
        if i - last_signal_index <= cooldown_bars:
            continue

        current = data[i]
        ema = current.get("ema")
        prev_ema = data[i - slope_period].get("ema")
        prev_short_ema = data[i - short_slope_period].get("ema")
        if None in (ema, prev_ema, prev_short_ema):
            continue

        o, h, l, c = current["open"], current["high"], current["low"], current["close"]
        is_up = c > o
        is_down = c < o
        ema_slope = (ema - prev_ema) / slope_period
        short_ema_slope = (ema - prev_short_ema) / short_slope_period
        upper_tail = h - max(o, c)
        lower_tail = min(o, c) - l
        low_to_ema = l - ema
        high_to_ema = h - ema
        close_to_ema = c - ema

        # Arity metrics
        avg_overlap, reversals = calculate_arity_metrics(data, i, lookback)

        is_strong_trend = (
            abs(short_ema_slope) >= strong_short_slope_threshold and
            abs(ema_slope) >= strong_slope_threshold
        )

        high_overlap_rejection_tail = (
            lower_tail >= extended_min_tail
            if short_ema_slope > 0
            else upper_tail >= extended_min_tail
        )
        if reversals >= 5 and avg_overlap > 0.60:
            continue
        if reversals == 4 and avg_overlap > 0.70 and not (
            is_strong_trend and high_overlap_rejection_tail and avg_overlap <= 0.90
        ):
            continue
        if reversals <= 3 and avg_overlap > 0.98:
            continue

        action = None
        setup_type = "mesReg5EmaBounceArity"
        buy_slope_ok = (
            short_ema_slope >= short_slope_threshold or
            (short_ema_slope >= relaxed_short_slope_threshold and ema_slope >= slope_threshold)
        )
        sell_slope_ok = (
            short_ema_slope <= -short_slope_threshold or
            (short_ema_slope <= -relaxed_short_slope_threshold and ema_slope <= -slope_threshold)
        )
        buy_near_ema = low_to_ema <= buy_low_to_ema_max
        sell_near_ema = high_to_ema >= sell_high_to_ema_min
        buy_extended_tail = (
            lower_tail >= extended_min_tail and
            low_to_ema <= extended_buy_low_to_ema_max and
            short_ema_slope >= extended_short_slope_threshold
        )
        sell_extended_tail = (
            upper_tail >= extended_min_tail and
            high_to_ema >= extended_sell_high_to_ema_min and
            short_ema_slope <= -extended_short_slope_threshold
        )

        if (
            is_up and
            buy_slope_ok and
            close_to_ema >= min_close_dist_buy and
            (buy_near_ema or buy_extended_tail)
        ):
            action = "Buy"
        elif (
            is_down and
            sell_slope_ok and
            -close_to_ema >= min_close_dist_sell and
            (sell_near_ema or sell_extended_tail)
        ):
            action = "Sell"
        elif (
            is_up and
            short_ema_slope >= pin_short_slope_threshold and
            ema_slope >= pin_slope_threshold and
            lower_tail >= pin_min_tail and
            pin_min_ema_distance <= low_to_ema <= pin_max_ema_distance and
            avg_overlap <= pin_max_overlap and
            reversals <= pin_max_reversals
        ):
            action = "Buy"
            setup_type = "mesReg5StrongTrendPinBar"
        elif (
            is_down and
            short_ema_slope <= -pin_short_slope_threshold and
            ema_slope <= -pin_slope_threshold and
            upper_tail >= pin_min_tail and
            -pin_max_ema_distance <= high_to_ema <= -pin_min_ema_distance and
            avg_overlap <= pin_max_overlap and
            reversals <= pin_max_reversals
        ):
            action = "Sell"
            setup_type = "mesReg5StrongTrendPinBar"

        if not action:
            continue
        if action == "Buy":
            touched_ema = low_to_ema <= buy_low_to_ema_max
        else:
            touched_ema = high_to_ema >= 0
        if not touched_ema and abs(close_to_ema) > max_chase_distance:
            continue

        rejection_tail = lower_tail if action == "Buy" else upper_tail
        is_protected_strong_tail = (
            is_strong_trend and
            abs(short_ema_slope) >= 0.42 * scale and
            rejection_tail >= 0.75 * scale
        )
        left_body_wall = calculate_left_body_wall(i)
        has_left_body_wall = (
            left_body_wall["count"] >= 5 and
            left_body_wall["bodySum"] >= 4.0 * scale and
            left_body_wall["shelfSpan"] <= 2.25 * scale and
            not is_protected_strong_tail
        )
        if has_left_body_wall:
            continue

        signal_details.append({
            "barIndex": i,
            "timestamp": current["time"],
            "action": action,
            "metrics": {
                "setupType": setup_type,
                "ema": ema,
                "emaSlope": ema_slope,
                "shortEmaSlope": short_ema_slope,
                "averageOverlap": avg_overlap,
                "reversals": reversals,
                "isStrongTrend": is_strong_trend,
                "lowToEma": low_to_ema,
                "highToEma": high_to_ema,
                "closeToEma": close_to_ema,
                "upperTail": upper_tail,
                "lowerTail": lower_tail,
                "usedExtendedTail": buy_extended_tail if action == "Buy" else sell_extended_tail,
                "usedPinBar": setup_type == "mesReg5StrongTrendPinBar",
                "leftBodyWall": left_body_wall,
                "rejectionTail": rejection_tail,
                "protectedStrongTail": is_protected_strong_tail,
            },
        })
        last_signal_index = i

    return signal_details, evaluate_signal_details(data, signal_details, config)


def parse_timestamp_seconds(value):
    if not value:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None

def bar_color(bar):
    if bar["close"] > bar["open"]:
        return "up"
    if bar["close"] < bar["open"]:
        return "down"
    return "flat"

def is_ha_indecision(bar, body_ratio_threshold):
    bar_range = max(0.0000001, bar["high"] - bar["low"])
    body = abs(bar["close"] - bar["open"])
    return body / bar_range <= body_ratio_threshold

def is_ha_continuation_breakout(direction, bar, cluster_low, cluster_high, min_body_ratio):
    bar_range = max(0.0000001, bar["high"] - bar["low"])
    body_ratio = abs(bar["close"] - bar["open"]) / bar_range
    ma1 = bar.get("ma1")

    if direction == "Buy":
        return (
            bar_color(bar) == "up" and
            body_ratio >= min_body_ratio and
            bar["close"] > cluster_high and
            (ma1 is None or bar["close"] > ma1)
        )

    return (
        bar_color(bar) == "down" and
        body_ratio >= min_body_ratio and
        bar["close"] < cluster_low and
        (ma1 is None or bar["close"] < ma1)
    )

def find_latest_ha_indecision_cluster(ha_window, direction, min_length, body_ratio_threshold, require_pullback_side=True):
    best = None
    index = 0
    while index < len(ha_window):
        if not is_ha_indecision(ha_window[index], body_ratio_threshold):
            index += 1
            continue

        end = index
        while end < len(ha_window) and is_ha_indecision(ha_window[end], body_ratio_threshold):
            end += 1

        if end - index >= min_length:
            cluster = ha_window[max(index, end - 6):end]
            cluster_low = min(bar["low"] for bar in cluster)
            cluster_high = max(bar["high"] for bar in cluster)
            if require_pullback_side:
                window_low = min(bar["low"] for bar in ha_window)
                window_high = max(bar["high"] for bar in ha_window)
                midpoint = (window_low + window_high) / 2
                cluster_midpoint = (cluster_low + cluster_high) / 2
                if direction == "Buy" and cluster_midpoint > midpoint:
                    index = end + 1
                    continue
                if direction == "Sell" and cluster_midpoint < midpoint:
                    index = end + 1
                    continue
            best = {
                "startOffset": max(index, end - 6),
                "endOffset": end - 1,
                "barCount": len(cluster),
                "low": cluster_low,
                "high": cluster_high,
                "startTime": cluster[0]["time"],
                "endTime": cluster[-1]["time"],
            }

        index = end + 1

    return best

def cluster_crosses_ha_10_ema(direction, cluster_bars, min_diff=0.0):
    if not cluster_bars:
        return False
    if direction == "Buy":
        return any(bar.get("ma1") is not None and (bar["ma1"] - bar["close"]) >= min_diff for bar in cluster_bars)
    return any(bar.get("ma1") is not None and (bar["close"] - bar["ma1"]) >= min_diff for bar in cluster_bars)

def find_latest_ha_10_ema_indecision_cluster(ha_window, direction, min_length, body_ratio_threshold, min_diff=0.0):
    best = None
    index = 0
    while index < len(ha_window):
        if not is_ha_indecision(ha_window[index], body_ratio_threshold):
            index += 1
            continue

        end = index
        while end < len(ha_window) and is_ha_indecision(ha_window[end], body_ratio_threshold):
            end += 1

        if end - index >= min_length:
            cluster = ha_window[max(index, end - 6):end]
            if cluster_crosses_ha_10_ema(direction, cluster, min_diff=min_diff):
                best = {
                    "startOffset": max(index, end - 6),
                    "endOffset": end - 1,
                    "barCount": len(cluster),
                    "low": min(bar["low"] for bar in cluster),
                    "high": max(bar["high"] for bar in cluster),
                    "startTime": cluster[0]["time"],
                    "endTime": cluster[-1]["time"],
                    "minMa1Distance": min(
                        (bar["close"] - bar["ma1"])
                        for bar in cluster
                        if bar.get("ma1") is not None
                    ),
                    "maxMa1Distance": max(
                        (bar["close"] - bar["ma1"])
                        for bar in cluster
                        if bar.get("ma1") is not None
                    ),
                }

        index = end + 1

    return best

def is_ha_10_ema_reclaim_breakout(direction, bar, cluster_low, cluster_high, min_body_ratio):
    ma1 = bar.get("ma1")
    if ma1 is None:
        return False

    bar_range = max(0.0000001, bar["high"] - bar["low"])
    body_ratio = abs(bar["close"] - bar["open"]) / bar_range
    if body_ratio < min_body_ratio:
        return False

    if direction == "Buy":
        return (
            bar_color(bar) == "up" and
            bar["close"] > ma1 and
            bar["close"] > cluster_high
        )

    return (
        bar_color(bar) == "down" and
        bar["close"] < ma1 and
        bar["close"] < cluster_low
    )

def run_mes3_ha_ema_approach_strategy(data, ha_data, config):
    if not ha_data:
        return []

    ha_times = [parse_timestamp_seconds(bar.get("time")) for bar in ha_data]
    signal_details = []
    tick_size = infer_price_increment(data)
    ema_slope_period = max(1, config.get("mes3_ha_ema_approach_slope_period", 8))
    ema_slope_threshold = config.get("mes3_ha_ema_approach_slope_threshold", 1.25)
    approach_ticks = config.get("mes3_ha_ema_approach_ticks", 4)
    approach_distance = tick_size * approach_ticks
    min_tail = config.get("mes3_ha_ema_approach_min_tail", tick_size)
    ha_cluster_min_bars = max(2, config.get("mes3_ha_indecision_min_bars", 2))
    ha_indecision_body_ratio = config.get("mes3_ha_indecision_body_ratio", 0.45)
    ha_breakout_body_ratio = config.get("mes3_ha_breakout_body_ratio", 0.45)
    ha_pre_seconds = config.get("mes3_ha_ema_approach_pre_seconds", 20)
    ha_post_seconds = config.get("mes3_ha_ema_approach_post_seconds", 12)
    cooldown_bars = max(0, config.get("mes3_ha_ema_approach_cooldown_bars", 1))
    ha_pullback_ticks = config.get("mes3_ha_ema_approach_pullback_ticks", 0)
    min_ha_diff = tick_size * ha_pullback_ticks
    last_signal_index = -999999

    for i in range(max(ema_slope_period, 1), len(data)):
        if i - last_signal_index <= cooldown_bars:
            continue

        current = data[i]
        previous = data[i - 1]
        ema = current.get("ema")
        previous_ema = data[i - ema_slope_period].get("ema")
        if ema is None or previous_ema is None:
            continue

        ema_slope = ema - previous_ema
        upper_tail = current["high"] - max(current["open"], current["close"])
        lower_tail = min(current["open"], current["close"]) - current["low"]
        action = None
        tail_distance_to_ema = None

        if (
            ema_slope >= ema_slope_threshold and
            current["close"] > ema and
            lower_tail >= min_tail and
            abs(current["low"] - ema) <= approach_distance
        ):
            action = "Buy"
            tail_distance_to_ema = current["low"] - ema
        elif (
            ema_slope <= -ema_slope_threshold and
            current["close"] < ema and
            upper_tail >= min_tail and
            abs(current["high"] - ema) <= approach_distance
        ):
            action = "Sell"
            tail_distance_to_ema = current["high"] - ema

        if not action:
            continue

        start_seconds = parse_timestamp_seconds(previous.get("time"))
        end_seconds = parse_timestamp_seconds(current.get("time"))
        if start_seconds is None or end_seconds is None:
            continue
        search_start_seconds = max(start_seconds - ha_pre_seconds, end_seconds - ha_pre_seconds)
        search_end_seconds = end_seconds + ha_post_seconds

        import bisect
        ha_start = bisect.bisect_left(ha_times, search_start_seconds)
        ha_end = bisect.bisect_right(ha_times, search_end_seconds)
        ha_window = ha_data[ha_start:ha_end]
        if len(ha_window) < ha_cluster_min_bars + 1:
            continue

        cluster = find_latest_ha_10_ema_indecision_cluster(
            ha_window,
            action,
            ha_cluster_min_bars,
            ha_indecision_body_ratio,
            min_diff=min_ha_diff
        )
        if not cluster:
            continue

        breakout = None
        breakout_start = ha_start + cluster["endOffset"] + 1
        for ha_index in range(breakout_start, ha_end):
            candidate = ha_data[ha_index]
            if is_ha_10_ema_reclaim_breakout(
                action,
                candidate,
                cluster["low"],
                cluster["high"],
                ha_breakout_body_ratio,
            ):
                breakout = candidate
                break

        if not breakout:
            continue

        signal_details.append({
            "barIndex": i,
            "timestamp": current["time"],
            "action": action,
            "metrics": {
                "setupType": "mes3HaEmaApproachIndecisionBreakout",
                "ema": ema,
                "emaSlope": ema_slope,
                "tailDistanceToEma": tail_distance_to_ema,
                "approachDistance": approach_distance,
                "upperTail": upper_tail,
                "lowerTail": lower_tail,
                "haClusterStartTime": cluster["startTime"],
                "haClusterEndTime": cluster["endTime"],
                "haClusterBars": cluster["barCount"],
                "haClusterLow": cluster["low"],
                "haClusterHigh": cluster["high"],
                "haClusterMinMa1Distance": cluster.get("minMa1Distance"),
                "haClusterMaxMa1Distance": cluster.get("maxMa1Distance"),
                "haBreakoutTime": breakout["time"],
                "haBreakoutOpen": breakout["open"],
                "haBreakoutHigh": breakout["high"],
                "haBreakoutLow": breakout["low"],
                "haBreakoutClose": breakout["close"],
                "haBreakoutMa1": breakout.get("ma1"),
            },
        })
        last_signal_index = i

    return signal_details

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

def run_daily_campaign(data, signal_details, config):
    target_bricks = 2.0
    stop_bricks = 2.0
    entry_cooldown_bars = 3
    be_trigger_bricks = 1.0

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
        active_trade = None
        trade_history = []
        done_for_the_day = False
        success_time = None
        last_exit_bar_index = -999

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
                    hit_stop = bar["low"] <= stop_price
                    hit_target = bar["high"] >= target_price
                    if hit_stop and hit_target:
                        if be_triggered:
                            daily_net_profit += 0.0
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                        else:
                            daily_net_profit -= stop_bricks
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -stop_bricks})
                        active_trade = None
                    elif hit_stop:
                        if be_triggered:
                            daily_net_profit += 0.0
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                        else:
                            daily_net_profit -= stop_bricks
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -stop_bricks})
                        active_trade = None
                    elif hit_target:
                        daily_net_profit += target_bricks
                        trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Win", "profit_bricks": target_bricks})
                        active_trade = None
                    else:
                        # Check if we trigger breakeven for the next bar
                        if bar["high"] >= entry_price + be_trigger_bricks * brick_size and not be_triggered:
                            active_trade["be_triggered"] = True
                            active_trade["stop_price"] = entry_price
                else: # Sell
                    hit_stop = bar["high"] >= stop_price
                    hit_target = bar["low"] <= target_price
                    if hit_stop and hit_target:
                        if be_triggered:
                            daily_net_profit += 0.0
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                        else:
                            daily_net_profit -= stop_bricks
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -stop_bricks})
                        active_trade = None
                    elif hit_stop:
                        if be_triggered:
                            daily_net_profit += 0.0
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "BE", "profit_bricks": 0.0})
                        else:
                            daily_net_profit -= stop_bricks
                            trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Loss", "profit_bricks": -stop_bricks})
                        active_trade = None
                    elif hit_target:
                        daily_net_profit += target_bricks
                        trade_history.append({**active_trade, "exit_time": bar["time"], "exit_barIndex": i, "result": "Win", "profit_bricks": target_bricks})
                        active_trade = None
                    else:
                        # Check if we trigger breakeven for the next bar
                        if bar["low"] <= entry_price - be_trigger_bricks * brick_size and not be_triggered:
                            active_trade["be_triggered"] = True
                            active_trade["stop_price"] = entry_price

                # Check target hit
                if daily_net_profit >= target_bricks:
                    done_for_the_day = True
                    success_time = bar["time"]
                    break

            if was_in_position and active_trade is None:
                last_exit_bar_index = i

            # A signal that completes while a position is open is ignored,
            # including a signal on the same bar that closes the position.
            # Enforce at least 2 vertical bars separating consecutive entries (i - last_exit_bar_index >= entry_cooldown_bars).
            if not was_in_position and active_trade is None and not done_for_the_day:
                if i in day_signals_by_index:
                    if last_exit_bar_index != -999 and (i - last_exit_bar_index) < entry_cooldown_bars:
                        continue
                    sig = day_signals_by_index[i]
                    direction = sig["action"]
                    entry_price = bar["close"]
                    stop_price = entry_price - stop_bricks * brick_size if direction == "Buy" else entry_price + stop_bricks * brick_size
                    target_price = entry_price + target_bricks * brick_size if direction == "Buy" else entry_price - target_bricks * brick_size

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
        "exit_strategy": "fixed",
        "summary": {
            "total_days": total_days,
            "winning_days": winning_days,
            "losing_days": losing_days,
            "win_rate": win_rate,
            "avg_success_time": avg_success_time_str,
            "max_drawdown_bricks": max_drawdown,
            "target_bricks": target_bricks
        }
    }

def infer_price_increment(data):
    values = []
    for bar in data[:min(len(data), 5000)]:
        values.extend([bar["open"], bar["high"], bar["low"], bar["close"]])
    unique_values = sorted(set(values))
    increments = [
        round(b - a, 10)
        for a, b in zip(unique_values, unique_values[1:])
        if b > a
    ]
    return min(increments) if increments else 1.0

def infer_range_size(data):
    range_counts = {}
    for bar in data:
        range_size = bar["high"] - bar["low"]
        if range_size <= 0:
            continue
        key = round(range_size, 10)
        range_counts[key] = range_counts.get(key, 0) + 1
    if range_counts:
        return max(range_counts.items(), key=lambda item: item[1])[0]

    body_counts = {}
    for bar in data:
        body_size = abs(bar["close"] - bar["open"])
        if body_size <= 0:
            continue
        key = round(body_size, 10)
        body_counts[key] = body_counts.get(key, 0) + 1
    return max(body_counts.items(), key=lambda item: item[1])[0] if body_counts else 1.0

def summarize_campaign(daily_reports, target_bricks, exit_strategy):
    total_days = len(daily_reports)
    winning_days = len([day for day in daily_reports if day["net_profit_bricks"] > 0])
    losing_days = len([day for day in daily_reports if day["net_profit_bricks"] <= 0])
    total_trades = sum(day["trades_count"] for day in daily_reports)
    total_skipped_trades = sum(len(day.get("skipped_trades", [])) for day in daily_reports)
    net_profit = sum(day["net_profit_bricks"] for day in daily_reports)
    winning_trades = 0
    losing_trades = 0
    breakeven_trades = 0
    max_drawdown = 0.0
    running_pnl = 0.0
    for day in daily_reports:
        for trade in day["trades"]:
            profit = trade.get("profit_bricks", 0.0)
            if profit > 0:
                winning_trades += 1
            elif profit < 0:
                losing_trades += 1
            else:
                breakeven_trades += 1
            running_pnl += profit
            max_drawdown = min(max_drawdown, running_pnl)

    return {
        "daily_reports": daily_reports,
        "exit_strategy": exit_strategy,
        "summary": {
            "total_days": total_days,
            "winning_days": winning_days,
            "losing_days": losing_days,
            "win_rate": (winning_days / total_days * 100) if total_days else 0.0,
            "total_trades": total_trades,
            "total_skipped_trades": total_skipped_trades,
            "winning_trades": winning_trades,
            "losing_trades": losing_trades,
            "breakeven_trades": breakeven_trades,
            "trade_win_rate": (winning_trades / total_trades * 100) if total_trades else 0.0,
            "net_profit_bricks": net_profit,
            "max_drawdown_bricks": max_drawdown,
            "target_bricks": target_bricks,
        }
    }

def write_mes_reg5_daily_recovery_report(report):
    rules = report.get("rules", {})
    summary = report.get("summary", {})
    tick_size = rules.get("tick_size", 0.25)
    range_size = rules.get("range_size", tick_size * 5)

    def ticks(points):
        return points / tick_size if tick_size else 0.0

    def time_only(timestamp):
        return timestamp.split("T")[1].replace("Z", "") if timestamp else ""

    lines = [
        "# MES Reg5 Daily Recovery Campaign Report",
        "",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## Summary",
        "",
        f"- Campaign: {report.get('name', 'MES Reg5 Daily Recovery')}",
        f"- Session: {rules.get('session', 'N/A')}",
        f"- Days traded: {summary.get('total_days', 0)}",
        f"- Winning days: {summary.get('winning_days', 0)}",
        f"- Losing/flat days: {summary.get('losing_days', 0)}",
        f"- Day win rate: {summary.get('win_rate', 0.0):.1f}%",
        f"- Total trades: {summary.get('total_trades', 0)}",
        f"- Fast-market skipped signals: {summary.get('total_skipped_trades', 0)}",
        f"- Paper quarantine trades: {summary.get('total_paper_trades', 0)}",
        f"- Quarantine events: {summary.get('total_quarantine_entries', 0)}",
        f"- Net result: {summary.get('net_profit_bricks', 0.0):.1f} bars / {summary.get('net_profit_bricks', 0.0) * range_size / tick_size:.0f} ticks",
        f"- Max campaign drawdown: {summary.get('max_drawdown_bricks', 0.0):.1f} bars / {summary.get('max_drawdown_bricks', 0.0) * range_size / tick_size:.0f} ticks",
        "",
        "## Rules Used",
        "",
    ]

    for key in ["entry", "target", "warmup", "fast_market_skip", "first_trade", "recovery", "quarantine", "session"]:
        if key in rules:
            lines.append(f"- {key.replace('_', ' ').title()}: {rules[key]}")

    lines.extend([
        "",
        "## Daily Breakdown",
        "",
        "| Date | Result | Trades | Paper | Fast Skips | Net Bars | Net Ticks | First Entry | Done Time |",
        "|---|---:|---:|---:|---:|---:|---:|---|---|",
    ])

    for day in report.get("daily_reports", []):
        done_time = time_only(day.get("success_time"))
        first_entry = time_only(day["trades"][0]["entry_time"]) if day.get("trades") else ""
        net_ticks = day.get("net_profit_bricks", 0.0) * range_size / tick_size if tick_size else 0.0
        fast_skips = len(day.get("skipped_trades", []))
        paper_trades = len(day.get("paper_trades", []))
        lines.append(
            f"| {day['date']} | {day['result']} | {day['trades_count']} | {paper_trades} | {fast_skips} | "
            f"{day.get('net_profit_bricks', 0.0):.1f} | {net_ticks:.0f} | {first_entry} | {done_time} |"
        )

    lines.extend(["", "## Trade Details", ""])
    for day in report.get("daily_reports", []):
        lines.extend([
            f"### {day['date']} - {day['result']} ({day['trades_count']} trades, {day.get('net_profit_bricks', 0.0):.1f} bars)",
            "",
            "| # | Direction | Entry | Entry Price | Exit | Exit Price | Result | P/L Ticks | Daily Cum Ticks |",
            "|---:|---|---|---:|---|---:|---|---:|---:|",
        ])
        for index, trade in enumerate(day.get("trades", []), 1):
            lines.append(
                f"| {index} | {trade['direction']} | {time_only(trade['entry_time'])} | {trade['entry_price']:.2f} | "
                f"{time_only(trade['exit_time'])} | {trade['exit_price']:.2f} | {trade['result']} | "
                f"{ticks(trade.get('profit_points', 0.0)):.0f} | {ticks(trade.get('daily_profit_points', 0.0)):.0f} |"
            )
        paper_trades = day.get("paper_trades", [])
        if paper_trades:
            lines.extend([
                "",
                "Paper quarantine trades:",
                "",
                "| # | Direction | Entry | Exit | Result | Paper P/L Ticks |",
                "|---:|---|---|---|---|---:|",
            ])
            for index, trade in enumerate(paper_trades, 1):
                lines.append(
                    f"| {index} | {trade['direction']} | {time_only(trade['entry_time'])} | "
                    f"{time_only(trade['exit_time'])} | {trade['result']} | "
                    f"{ticks(trade.get('profit_points', 0.0)):.0f} |"
                )
        skipped_trades = day.get("skipped_trades", [])
        if skipped_trades:
            lines.extend([
                "",
                "Skipped fast-market signals:",
                "",
                "| # | Direction | Time | Seconds Since Previous Bar | Reason |",
                "|---:|---|---|---:|---|",
            ])
            for index, skipped in enumerate(skipped_trades, 1):
                lines.append(
                    f"| {index} | {skipped['direction']} | {time_only(skipped['time'])} | "
                    f"{skipped.get('seconds_since_previous_bar', 0.0):.1f} | {skipped.get('reason', '')} |"
                )
        lines.append("")

    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_dir = os.path.join(project_dir, "scratch")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "mes-reg5-daily-recovery-report.md")
    with open(output_path, "w") as report_file:
        report_file.write("\n".join(lines) + "\n")

def run_mes_reg5_daily_recovery_campaign(data, signal_details, config):
    campaign_name = "MES Reg5 Daily Recovery"
    start_time = "06:30:00"
    end_time = "14:00:00"
    tick_size = infer_price_increment(data)
    range_size = infer_range_size(data)
    target_points = range_size
    stop_points = range_size * 1.5
    warmup_bars = 10
    min_manual_signal_seconds = 3.0
    quarantine_loss_threshold = 3
    quarantine_required_paper_wins = 1

    def bar_direction(bar):
        if bar["close"] > bar["open"]:
            return "Buy"
        if bar["close"] < bar["open"]:
            return "Sell"
        return "Flat"

    def in_session(timestamp):
        time = timestamp.split("T")[1].replace("Z", "")
        return start_time <= time <= end_time

    def seconds_from_previous_bar(index):
        if index <= 0:
            return None
        try:
            current_time = datetime.fromisoformat(data[index]["time"].replace("Z", "+00:00"))
            previous_time = datetime.fromisoformat(data[index - 1]["time"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            return None
        return (current_time - previous_time).total_seconds()

    date_to_bar_indices = {}
    for index, bar in enumerate(data):
        date = bar["time"].split("T")[0]
        date_to_bar_indices.setdefault(date, []).append(index)

    date_to_signals = {}
    for signal in signal_details:
        date = signal["timestamp"].split("T")[0]
        if in_session(signal["timestamp"]):
            date_to_signals.setdefault(date, []).append(signal)

    daily_reports = []
    for date in sorted(date_to_signals):
        day_signals = sorted(date_to_signals[date], key=lambda signal: signal["barIndex"])
        session_bar_indices = [
            index
            for index in date_to_bar_indices.get(date, [])
            if in_session(data[index]["time"])
        ]
        first_eligible_entry_index = (
            session_bar_indices[warmup_bars]
            if len(session_bar_indices) > warmup_bars
            else 999999999
        )
        daily_profit_points = 0.0
        trades = []
        paper_trades = []
        skipped_trades = []
        next_eligible_entry_index = -1
        consecutive_losses = 0
        in_quarantine = False
        paper_wins = 0
        quarantine_entries = 0

        for signal in day_signals:
            if daily_profit_points >= target_points:
                break

            entry_index = signal["barIndex"]
            if entry_index < first_eligible_entry_index:
                continue
            if entry_index <= next_eligible_entry_index:
                continue

            entry_bar = data[entry_index]
            if not in_session(entry_bar["time"]):
                continue

            seconds_since_previous = seconds_from_previous_bar(entry_index)
            if (
                seconds_since_previous is not None and
                seconds_since_previous < min_manual_signal_seconds
            ):
                skipped_trades.append({
                    "campaign": campaign_name,
                    "time": entry_bar["time"],
                    "barIndex": entry_index,
                    "direction": signal["action"],
                    "reason": "FastMarket",
                    "seconds_since_previous_bar": seconds_since_previous,
                })
                continue

            direction = signal["action"]
            direction_multiplier = 1 if direction == "Buy" else -1
            entry_price = entry_bar["close"]
            first_trade = len(trades) == 0
            remaining_target_points = target_points - daily_profit_points
            exit_index = None
            exit_price = None
            profit_points = None
            result = None

            for index in range(entry_index + 1, len(data)):
                bar = data[index]
                if bar["time"].split("T")[0] != date or not in_session(bar["time"]):
                    exit_index = max(entry_index, index - 1)
                    exit_bar = data[exit_index]
                    exit_price = exit_bar["close"]
                    profit_points = (exit_price - entry_price) * direction_multiplier
                    result = "EndSession"
                    break

                favorable_points = (
                    bar["high"] - entry_price
                    if direction == "Buy"
                    else entry_price - bar["low"]
                )
                adverse_points = (
                    entry_price - bar["low"]
                    if direction == "Buy"
                    else bar["high"] - entry_price
                )
                if first_trade:
                    hit_target = favorable_points >= target_points
                    hit_stop = adverse_points >= stop_points
                    if hit_stop:
                        exit_index = index
                        exit_price = entry_price - direction_multiplier * stop_points
                        profit_points = -stop_points
                        result = "FirstStop"
                        break
                    if hit_target:
                        exit_index = index
                        exit_price = entry_price + direction_multiplier * target_points
                        profit_points = target_points
                        result = "DailyTarget"
                        break
                else:
                    if favorable_points >= remaining_target_points:
                        exit_index = index
                        exit_price = entry_price + direction_multiplier * remaining_target_points
                        profit_points = remaining_target_points
                        result = "RecoveryTarget"
                        break
                    if adverse_points >= stop_points:
                        exit_index = index
                        exit_price = entry_price - direction_multiplier * stop_points
                        profit_points = -stop_points
                        result = "RecoveryStop"
                        break
                    current_direction = bar_direction(bar)
                    if current_direction != "Flat" and current_direction != direction:
                        current_profit_points = (bar["close"] - entry_price) * direction_multiplier
                        if current_profit_points > 0:
                            exit_index = index
                            exit_price = bar["close"]
                            profit_points = current_profit_points
                            result = "OppositeClose"
                            break

            if exit_index is None:
                exit_index = entry_index
                exit_price = entry_price
                profit_points = 0.0
                result = "NoExit"

            next_eligible_entry_index = exit_index
            trade = {
                "campaign": campaign_name,
                "entry_time": entry_bar["time"],
                "entry_barIndex": entry_index,
                "direction": direction,
                "entry_price": entry_price,
                "exit_time": data[exit_index]["time"],
                "exit_barIndex": exit_index,
                "exit_price": exit_price,
                "result": result,
                "profit_points": profit_points,
                "profit_bricks": profit_points / range_size,
            }

            if in_quarantine:
                if profit_points > 0:
                    paper_wins += 1
                paper_trades.append({
                    **trade,
                    "paper_wins_in_window": paper_wins,
                })
                if paper_wins >= quarantine_required_paper_wins:
                    in_quarantine = False
                    consecutive_losses = 0
                    paper_wins = 0
                continue

            daily_profit_points += profit_points
            if profit_points < 0:
                consecutive_losses += 1
            elif profit_points > 0:
                consecutive_losses = 0

            trades.append({
                **trade,
                "daily_profit_points": daily_profit_points,
                "daily_profit_bricks": daily_profit_points / range_size,
                "is_campaign_complete": daily_profit_points >= target_points,
            })

            if (
                daily_profit_points < target_points and
                consecutive_losses >= quarantine_loss_threshold
            ):
                in_quarantine = True
                quarantine_entries += 1
                paper_wins = 0

        daily_reports.append({
            "date": date,
            "net_profit_bricks": daily_profit_points / range_size,
            "result": "Win" if daily_profit_points >= target_points else "Loss/Flat",
            "success_time": trades[-1]["exit_time"] if daily_profit_points >= target_points and trades else None,
            "trades_count": len(trades),
            "trades": trades,
            "paper_trades": paper_trades,
            "skipped_trades": skipped_trades,
            "quarantine_entries": quarantine_entries,
        })

    result = summarize_campaign(daily_reports, 1.0, "mes_reg5_daily_recovery")
    result["name"] = campaign_name
    result["summary"]["total_paper_trades"] = sum(len(day.get("paper_trades", [])) for day in daily_reports)
    result["summary"]["total_quarantine_entries"] = sum(day.get("quarantine_entries", 0) for day in daily_reports)
    target_ticks = int(range_size / tick_size) if tick_size else 0
    stop_ticks = int(stop_points / tick_size) if tick_size else 0
    result["rules"] = {
        "entry": "Close of MES Reg5 EMA Bounce Arity arrow bar",
        "target": f"Stop for the day at +1 bar (+{target_ticks} ticks)",
        "warmup": "Ignore signals until at least 10 session bars have formed",
        "fast_market_skip": "Skip otherwise eligible signals when the signal bar forms less than 3 seconds after the previous bar",
        "first_trade": f"First trade wins at +{target_ticks} ticks or loses at -{stop_ticks} ticks (1.5 bars)",
        "recovery": f"Recovery trades hold until daily P/L reaches +{target_ticks} ticks, a -{stop_ticks} tick trade stop is hit, or an opposite-color close appears while the trade is already profitable",
        "quarantine": "After 3 consecutive real losses, paper-trade qualifying signals until 1 paper winner appears, then resume real trades",
        "session": f"{start_time} to {end_time}",
        "range_size": range_size,
        "tick_size": tick_size,
    }
    write_mes_reg5_daily_recovery_report(result)
    return result

def run_mes_reg5_quarantine_experiments(data, signal_details, config):
    start_time = "06:30:00"
    end_time = "14:00:00"
    tick_size = infer_price_increment(data)
    range_size = infer_range_size(data)
    target_points = range_size
    first_stop_points = range_size * 2.0
    warmup_bars = 10
    min_manual_signal_seconds = 3.0

    variants = [
        {
            "name": "after_2_losses_until_1_paper_win",
            "loss_threshold": 2,
            "resume_mode": "until_wins",
            "required_paper_wins": 1,
        },
        {
            "name": "after_3_losses_until_1_paper_win",
            "loss_threshold": 3,
            "resume_mode": "until_wins",
            "required_paper_wins": 1,
        },
        {
            "name": "after_2_losses_next_2_any_win",
            "loss_threshold": 2,
            "resume_mode": "block",
            "paper_block_size": 2,
            "required_paper_wins": 1,
        },
        {
            "name": "after_2_losses_next_2_both_win",
            "loss_threshold": 2,
            "resume_mode": "block",
            "paper_block_size": 2,
            "required_paper_wins": 2,
        },
        {
            "name": "after_3_losses_next_2_any_win",
            "loss_threshold": 3,
            "resume_mode": "block",
            "paper_block_size": 2,
            "required_paper_wins": 1,
        },
    ]

    def bar_direction(bar):
        if bar["close"] > bar["open"]:
            return "Buy"
        if bar["close"] < bar["open"]:
            return "Sell"
        return "Flat"

    def in_session(timestamp):
        time = timestamp.split("T")[1].replace("Z", "")
        return start_time <= time <= end_time

    def seconds_from_previous_bar(index):
        if index <= 0:
            return None
        try:
            current_time = datetime.fromisoformat(data[index]["time"].replace("Z", "+00:00"))
            previous_time = datetime.fromisoformat(data[index - 1]["time"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            return None
        return (current_time - previous_time).total_seconds()

    def simulate_trade(signal, daily_profit_points, real_trade_count, date):
        entry_index = signal["barIndex"]
        entry_bar = data[entry_index]
        direction = signal["action"]
        direction_multiplier = 1 if direction == "Buy" else -1
        entry_price = entry_bar["close"]
        first_trade = real_trade_count == 0
        remaining_target_points = target_points - daily_profit_points
        exit_index = None
        exit_price = None
        profit_points = None
        result = None

        for index in range(entry_index + 1, len(data)):
            bar = data[index]
            if bar["time"].split("T")[0] != date or not in_session(bar["time"]):
                exit_index = max(entry_index, index - 1)
                exit_bar = data[exit_index]
                exit_price = exit_bar["close"]
                profit_points = (exit_price - entry_price) * direction_multiplier
                result = "EndSession"
                break

            favorable_points = (
                bar["high"] - entry_price
                if direction == "Buy"
                else entry_price - bar["low"]
            )
            adverse_points = (
                entry_price - bar["low"]
                if direction == "Buy"
                else bar["high"] - entry_price
            )
            if first_trade:
                if adverse_points >= first_stop_points:
                    exit_index = index
                    exit_price = entry_price - direction_multiplier * first_stop_points
                    profit_points = -first_stop_points
                    result = "FirstStop"
                    break
                if favorable_points >= target_points:
                    exit_index = index
                    exit_price = entry_price + direction_multiplier * target_points
                    profit_points = target_points
                    result = "DailyTarget"
                    break
            else:
                if favorable_points >= remaining_target_points:
                    exit_index = index
                    exit_price = entry_price + direction_multiplier * remaining_target_points
                    profit_points = remaining_target_points
                    result = "RecoveryTarget"
                    break
                if adverse_points >= first_stop_points:
                    exit_index = index
                    exit_price = entry_price - direction_multiplier * first_stop_points
                    profit_points = -first_stop_points
                    result = "RecoveryStop"
                    break
                current_direction = bar_direction(bar)
                if current_direction != "Flat" and current_direction != direction:
                    current_profit_points = (bar["close"] - entry_price) * direction_multiplier
                    if current_profit_points > 0:
                        exit_index = index
                        exit_price = bar["close"]
                        profit_points = current_profit_points
                        result = "OppositeClose"
                        break

        if exit_index is None:
            exit_index = entry_index
            exit_price = entry_price
            profit_points = 0.0
            result = "NoExit"

        return {
            "entry_time": entry_bar["time"],
            "entry_barIndex": entry_index,
            "direction": direction,
            "entry_price": entry_price,
            "exit_time": data[exit_index]["time"],
            "exit_barIndex": exit_index,
            "exit_price": exit_price,
            "result": result,
            "profit_points": profit_points,
            "profit_bricks": profit_points / range_size,
        }

    date_to_bar_indices = {}
    for index, bar in enumerate(data):
        date = bar["time"].split("T")[0]
        date_to_bar_indices.setdefault(date, []).append(index)

    date_to_signals = {}
    for signal in signal_details:
        date = signal["timestamp"].split("T")[0]
        if in_session(signal["timestamp"]):
            date_to_signals.setdefault(date, []).append(signal)

    def run_variant(variant):
        daily_reports = []
        total_paper_trades = 0
        total_quarantine_entries = 0
        avoided_loss_points = 0.0
        missed_profit_points = 0.0

        for date in sorted(date_to_signals):
            day_signals = sorted(date_to_signals[date], key=lambda signal: signal["barIndex"])
            session_bar_indices = [
                index
                for index in date_to_bar_indices.get(date, [])
                if in_session(data[index]["time"])
            ]
            first_eligible_entry_index = (
                session_bar_indices[warmup_bars]
                if len(session_bar_indices) > warmup_bars
                else 999999999
            )
            daily_profit_points = 0.0
            trades = []
            paper_trades = []
            skipped_trades = []
            next_eligible_entry_index = -1
            consecutive_losses = 0
            in_quarantine = False
            paper_wins = 0
            paper_seen = 0
            day_quarantine_entries = 0

            for signal in day_signals:
                if daily_profit_points >= target_points:
                    break

                entry_index = signal["barIndex"]
                if entry_index < first_eligible_entry_index:
                    continue
                if entry_index <= next_eligible_entry_index:
                    continue

                entry_bar = data[entry_index]
                if not in_session(entry_bar["time"]):
                    continue

                seconds_since_previous = seconds_from_previous_bar(entry_index)
                if (
                    seconds_since_previous is not None and
                    seconds_since_previous < min_manual_signal_seconds
                ):
                    skipped_trades.append({
                        "time": entry_bar["time"],
                        "barIndex": entry_index,
                        "direction": signal["action"],
                        "reason": "FastMarket",
                        "seconds_since_previous_bar": seconds_since_previous,
                    })
                    continue

                trade = simulate_trade(signal, daily_profit_points, len(trades), date)
                next_eligible_entry_index = trade["exit_barIndex"]

                if in_quarantine:
                    total_paper_trades += 1
                    paper_seen += 1
                    if trade["profit_points"] > 0:
                        paper_wins += 1
                        missed_profit_points += trade["profit_points"]
                    elif trade["profit_points"] < 0:
                        avoided_loss_points += abs(trade["profit_points"])

                    paper_trades.append({
                        **trade,
                        "paper_wins_in_window": paper_wins,
                        "paper_seen_in_window": paper_seen,
                    })

                    if variant["resume_mode"] == "until_wins":
                        if paper_wins >= variant["required_paper_wins"]:
                            in_quarantine = False
                            consecutive_losses = 0
                            paper_wins = 0
                            paper_seen = 0
                    elif paper_seen >= variant["paper_block_size"]:
                        if paper_wins >= variant["required_paper_wins"]:
                            in_quarantine = False
                            consecutive_losses = 0
                        paper_wins = 0
                        paper_seen = 0
                    continue

                daily_profit_points += trade["profit_points"]
                trade["daily_profit_points"] = daily_profit_points
                trade["daily_profit_bricks"] = daily_profit_points / range_size
                trade["is_campaign_complete"] = daily_profit_points >= target_points
                trades.append(trade)

                if trade["profit_points"] < 0:
                    consecutive_losses += 1
                elif trade["profit_points"] > 0:
                    consecutive_losses = 0

                if (
                    daily_profit_points < target_points and
                    consecutive_losses >= variant["loss_threshold"]
                ):
                    in_quarantine = True
                    total_quarantine_entries += 1
                    day_quarantine_entries += 1
                    paper_wins = 0
                    paper_seen = 0

            daily_reports.append({
                "date": date,
                "net_profit_bricks": daily_profit_points / range_size,
                "result": "Win" if daily_profit_points >= target_points else "Loss/Flat",
                "success_time": trades[-1]["exit_time"] if daily_profit_points >= target_points and trades else None,
                "trades_count": len(trades),
                "trades": trades,
                "paper_trades": paper_trades,
                "skipped_trades": skipped_trades,
                "quarantine_entries": day_quarantine_entries,
            })

        result = summarize_campaign(daily_reports, 1.0, f"mes_reg5_quarantine:{variant['name']}")
        result["name"] = variant["name"]
        result["variant"] = variant
        result["summary"]["total_paper_trades"] = total_paper_trades
        result["summary"]["total_quarantine_entries"] = total_quarantine_entries
        result["summary"]["avoided_loss_bricks"] = avoided_loss_points / range_size
        result["summary"]["missed_profit_bricks"] = missed_profit_points / range_size
        return result

    baseline = run_mes_reg5_daily_recovery_campaign(data, signal_details, config)
    results = [run_variant(variant) for variant in variants]
    ranked = sorted(
        results,
        key=lambda result: (
            result["summary"].get("winning_days", 0),
            result["summary"].get("net_profit_bricks", 0.0),
            -abs(result["summary"].get("max_drawdown_bricks", 0.0)),
            -result["summary"].get("total_trades", 0),
        ),
        reverse=True,
    )

    return {
        "objective": "Test paper-trade quarantine rules after consecutive real losses in the MES Reg5 Daily Recovery campaign.",
        "baseline_summary": baseline.get("summary", {}),
        "variants": results,
        "ranked": [
            {
                "name": result["name"],
                "variant": result["variant"],
                "summary": result["summary"],
            }
            for result in ranked
        ],
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
        target_val = summary.get("target_bricks", 2.0)
        print(f"  - Winning Days (+{target_val} bricks target): {summary['winning_days']} ({summary['win_rate']:.2f}%)")
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
    parser.add_argument("--start-time", default="06:31:00", help="Start time of daily trading session (PST, HH:MM:SS)")
    parser.add_argument("--end-time", default="11:00:00", help="End time of daily trading session (PST, HH:MM:SS)")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")
    parser.add_argument("--optimize", action="store_true", help="Run parameter optimization sweep")
    parser.add_argument("--experiment-mes-reg5-quarantine", action="store_true", help="Run MES Reg5 paper-trade quarantine experiments")
    
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

    config["chart_name"] = args.chart

    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    chart_path = os.path.join(project_dir, "data", f"{args.chart}.json")
    annotations_path = os.path.join(project_dir, "data", "annotations.json")

    try:
        data = load_json_data(chart_path)
        annotations = load_annotations(annotations_path, args.chart)
        ha_data = []
        ha_path = os.path.join(project_dir, "data", "MES_2sec_HA.json")
        if args.chart in ("MES3", "MESM_reg_5") and os.path.exists(ha_path):
            ha_data = load_json_data(ha_path)
        
        if args.optimize:
            best_config = run_optimization(data, annotations)
            print(json.dumps(best_config, indent=2))
            import sys
            sys.exit(0)
            
        signals, signal_details, signal_evaluations = run_strategy(data, config)
        mes3_trend_tail_details, mes3_trend_tail_evaluations = run_mes3_trend_tail_strategy(data, config)
        mes3_previous_tail_details, mes3_previous_tail_evaluations = run_mes3_previous_tail_rejection_strategy(data, config)
        mes3_ha_ema_approach_details = run_mes3_ha_ema_approach_strategy(data, ha_data, config)
        mes_reg5_long_tail_details, mes_reg5_long_tail_evaluations = run_mes_reg5_long_tail_strategy(data, config)
        mes_reg5_ema_bounce_arity_details, mes_reg5_ema_bounce_arity_evaluations = run_mes_reg5_ema_bounce_arity_strategy(data, config)
        if args.experiment_mes_reg5_quarantine:
            experiment_results = run_mes_reg5_quarantine_experiments(
                data,
                mes_reg5_ema_bounce_arity_details,
                config,
            )
            print(json.dumps(experiment_results, indent=2))
            import sys
            sys.exit(0)
        matches, false_negatives, false_positives = analyze_alignment(signals, annotations, data)
        campaign_results = run_daily_campaign(data, signal_details, config)
        mes_reg5_daily_recovery_campaign_results = run_mes_reg5_daily_recovery_campaign(
            data,
            mes_reg5_ema_bounce_arity_details,
            config,
        )
        
        if args.json:
            result = {
                "signals": signals,
                "signal_details": signal_details,
                "signal_evaluations": signal_evaluations,
                "mes3_trend_tail_details": mes3_trend_tail_details,
                "mes3_trend_tail_evaluations": mes3_trend_tail_evaluations,
                "mes3_previous_tail_details": mes3_previous_tail_details,
                "mes3_previous_tail_evaluations": mes3_previous_tail_evaluations,
                "mes3_ha_ema_approach_details": mes3_ha_ema_approach_details,
                "mes_reg5_long_tail_details": mes_reg5_long_tail_details,
                "mes_reg5_long_tail_evaluations": mes_reg5_long_tail_evaluations,
                "mes_reg5_ema_bounce_arity_details": mes_reg5_ema_bounce_arity_details,
                "mes_reg5_ema_bounce_arity_evaluations": mes_reg5_ema_bounce_arity_evaluations,
                "campaign_results": campaign_results,
                "mes_reg5_daily_recovery_campaign_results": mes_reg5_daily_recovery_campaign_results,
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
