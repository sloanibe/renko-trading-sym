import json
import os
import random
from datetime import datetime, timedelta

def calculate_ema(bricks, ema_period=8):
    multiplier = 2.0 / (ema_period + 1.0)
    if len(bricks) < ema_period:
        initial_closes = [b["close"] for b in bricks]
        avg = sum(initial_closes) / len(initial_closes) if initial_closes else 0
        for b in bricks:
            b["ema"] = round(avg, 4)
        return
        
    initial_closes = [b["close"] for b in bricks[:ema_period]]
    current_ema = sum(initial_closes) / len(initial_closes)
    
    for i in range(len(bricks)):
        close_val = bricks[i]["close"]
        if i < ema_period:
            bricks[i]["ema"] = round(current_ema, 4)
        else:
            current_ema = (close_val * multiplier) + (current_ema * (1.0 - multiplier))
            bricks[i]["ema"] = round(current_ema, 4)

def format_time_series(bricks, start_time):
    formatted = []
    current_time = start_time
    for b in bricks:
        seconds = random.randint(30, 120)
        current_time += timedelta(seconds=seconds)
        formatted.append({
            "time": current_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "open": round(b["open"], 2),
            "high": round(b["high"], 2),
            "low": round(b["low"], 2),
            "close": round(b["close"], 2),
            "ema": b["ema"]
        })
    return formatted

def generate_tick_by_tick_market(market_type, target_bricks=180, brick_size=15.0, start_price=18400.0):
    prices = [start_price]
    bricks = []
    
    # Establish baseline Renko state
    current_close = round(start_price / brick_size) * brick_size
    first_direction = None
    first_open = current_close
    
    price = start_price
    temp_prices = []
    last_dir = None
    
    # Track centers for mean reversion in choppy phases
    bottom_center = None
    top_center = None
    
    # Micro-state machine for realistic impulses and corrections
    micro_state = "impulse"
    state_ticks = 0
    
    while len(bricks) < target_bricks:
        # Determine progress
        progress = len(bricks) / target_bricks
        
        # Micro-state transitions (impulse vs pullback)
        state_ticks += 1
        if micro_state == "impulse":
            if state_ticks > random.randint(45, 75):
                micro_state = "correction"
                state_ticks = 0
        else: # correction
            # Corrective pullbacks last 25 to 50 ticks to allow counter-trend moves to form bricks
            if state_ticks > random.randint(25, 50):
                micro_state = "impulse"
                state_ticks = 0
        
        # Market type behaviors
        if market_type == "realistic":
            # Phase 1 (0% to 20%): Strong downtrend with pullbacks
            if progress < 0.20:
                if micro_state == "impulse":
                    drift = -1.1
                    noise = 1.5
                else:
                    drift = 1.25  # Strong pullback up (should trigger reversals)
                    noise = 2.0
            # Phase 2 (20% to 35%): Weak choppy uptrend (pullback)
            elif progress < 0.35:
                if micro_state == "impulse":
                    drift = 0.50
                    noise = 3.0
                else:
                    drift = -0.50
                    noise = 3.0
            # Phase 3 (35% to 50%): Final leg of downtrend and bottom consolidation
            elif progress < 0.50:
                if progress < 0.45:
                    if micro_state == "impulse":
                        drift = -1.0
                        noise = 1.6
                    else:
                        drift = 1.1
                        noise = 2.0
                else:
                    # Bottom chop
                    if bottom_center is None:
                        bottom_center = price
                    drift = -0.06 * (price - bottom_center)
                    noise = 4.2
            # Phase 4 (50% to 70%): Strong clean uptrend with pullbacks
            elif progress < 0.70:
                if micro_state == "impulse":
                    drift = 1.15
                    noise = 1.4
                else:
                    drift = -1.30  # Strong pullback down
                    noise = 2.0
            # Phase 5 (70% to 85%): Congested, choppy top
            elif progress < 0.85:
                if top_center is None:
                    top_center = price
                drift = -0.06 * (price - top_center)
                noise = 4.5
            # Phase 6 (85% to 100%): Rolling weak downtrend to finish
            else:
                if micro_state == "impulse":
                    drift = -0.65
                    noise = 2.0
                else:
                    drift = 0.55
                    noise = 2.2
                    
        elif market_type == "trending":
            # strong uptrend -> choppy top -> strong downtrend
            if progress < 0.45:
                if micro_state == "impulse":
                    drift = 1.1
                    noise = 1.4
                else:
                    drift = -1.1
                    noise = 2.0
            elif progress < 0.55:
                drift = 0.0
                noise = 4.0
            else:
                if micro_state == "impulse":
                    drift = -1.1
                    noise = 1.4
                else:
                    drift = 1.1
                    noise = 2.0
                
        elif market_type == "choppy":
            # Ornstein-Uhlenbeck-like mean reversion to keep it range bound
            center = start_price
            drift = -0.06 * (price - center)
            noise = 4.2
            
        elif market_type == "congested":
            # Volatile slow uptrend
            if micro_state == "impulse":
                drift = 0.5
                noise = 3.8
            else:
                drift = -0.4
                noise = 4.2
            
        else:
            drift = 0.0
            noise = 2.0
            
        # Simulate price tick step
        step = drift + random.normalvariate(0, noise)
        price += step
        prices.append(price)
        
        # Stateful Renko Filtering
        if first_direction is None:
            # Establish the first brick's direction
            if price >= first_open + brick_size:
                first_direction = "Up"
                current_close = first_open + brick_size
                bricks.append({
                    "open": first_open,
                    "close": current_close,
                    "high": current_close,
                    "low": first_open,
                })
                last_dir = "Up"
            elif price <= first_open - brick_size:
                first_direction = "Down"
                current_close = first_open - brick_size
                bricks.append({
                    "open": first_open,
                    "close": current_close,
                    "high": first_open,
                    "low": current_close,
                })
                last_dir = "Down"
        else:
            temp_prices.append(price)
            if last_dir == "Up":
                # Continuation Up: price reaches current_close + brick_size
                # Reversal Down: price reaches current_close - 2 * brick_size
                if price >= current_close + brick_size:
                    o = current_close
                    c = o + brick_size
                    h = c  # Up bricks have no upper wicks in trend direction
                    l = min(temp_prices)
                    
                    # Safety check: pullback wick cannot exceed the reversal threshold (2 * brick_size)
                    if o - l >= 2.0 * brick_size:
                        l = o - (2.0 * brick_size - 0.5)
                        
                    bricks.append({"open": o, "high": h, "low": l, "close": c})
                    current_close = c
                    temp_prices = []
                elif price <= current_close - 2.0 * brick_size:
                    # Reversal opens at previous brick's open (which is current_close - brick_size)
                    o = current_close - brick_size
                    c = o - brick_size
                    l = c  # Down bricks have no lower wicks in trend direction
                    h = max(temp_prices)
                    
                    # Safety check: pullback wick cannot exceed the continuation threshold (brick_size)
                    if h - o >= brick_size:
                        h = o + (brick_size - 0.5)
                        
                    bricks.append({"open": o, "high": h, "low": l, "close": c})
                    current_close = c
                    last_dir = "Down"
                    temp_prices = []
            else: # last_dir == "Down"
                # Continuation Down: price reaches current_close - brick_size
                # Reversal Up: price reaches current_close + 2 * brick_size
                if price <= current_close - brick_size:
                    o = current_close
                    c = o - brick_size
                    l = c  # Down bricks have no lower wicks in trend direction
                    h = max(temp_prices)
                    
                    # Safety check: pullback wick cannot exceed the reversal threshold (2 * brick_size)
                    if h - o >= 2.0 * brick_size:
                        h = o + (2.0 * brick_size - 0.5)
                        
                    bricks.append({"open": o, "high": h, "low": l, "close": c})
                    current_close = c
                    temp_prices = []
                elif price >= current_close + 2.0 * brick_size:
                    # Reversal opens at previous brick's open (which is current_close + brick_size)
                    o = current_close + brick_size
                    c = o + brick_size
                    h = c  # Up bricks have no upper wicks in trend direction
                    l = min(temp_prices)
                    
                    # Safety check: pullback wick cannot exceed the continuation threshold (brick_size)
                    if o - l >= brick_size:
                        l = o - (brick_size - 0.5)
                        
                    bricks.append({"open": o, "high": h, "low": l, "close": c})
                    current_close = c
                    last_dir = "Up"
                    temp_prices = []
                    
    calculate_ema(bricks)
    return bricks

if __name__ == "__main__":
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # 1. Master Realistic Market (400 bricks)
    realistic_bricks = generate_tick_by_tick_market("realistic", target_bricks=400)
    realistic_data = format_time_series(realistic_bricks, datetime(2026, 6, 9, 6, 30, 0))
    realistic_path = os.path.join(data_dir, "MNQ_Realistic_Market.json")
    with open(realistic_path, "w") as f:
        json.dump(realistic_data, f, indent=2)
    print(f"Generated master realistic market chart at: {realistic_path}")

    # 2. Choppy Market
    choppy_bricks = generate_tick_by_tick_market("choppy", target_bricks=180)
    choppy_data = format_time_series(choppy_bricks, datetime(2026, 6, 9, 6, 30, 0))
    choppy_path = os.path.join(data_dir, "MNQ_Choppy_Market.json")
    with open(choppy_path, "w") as f:
        json.dump(choppy_data, f, indent=2)
    print(f"Generated choppy market chart at: {choppy_path}")
    
    # 3. Trending Market
    trending_bricks = generate_tick_by_tick_market("trending", target_bricks=180)
    trending_data = format_time_series(trending_bricks, datetime(2026, 6, 9, 6, 30, 0))
    trending_path = os.path.join(data_dir, "MNQ_Trending_Market.json")
    with open(trending_path, "w") as f:
        json.dump(trending_data, f, indent=2)
    print(f"Generated trending market chart at: {trending_path}")
    
    # 4. Congested Trend Market
    congested_bricks = generate_tick_by_tick_market("congested", target_bricks=180)
    congested_data = format_time_series(congested_bricks, datetime(2026, 6, 9, 6, 30, 0))
    congested_path = os.path.join(data_dir, "MNQ_Congested_Trend.json")
    with open(congested_path, "w") as f:
        json.dump(congested_data, f, indent=2)
    print(f"Generated congested trend chart at: {congested_path}")
