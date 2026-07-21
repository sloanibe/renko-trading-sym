#!/usr/bin/env python3
"""Day-by-day analysis of the MESM_reg_5 manual_entry1 signal set."""
import json
from collections import defaultdict, Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "data/MESM_reg_5.json").read_text())
ALL_ANNOTATIONS = json.loads((ROOT / "data/annotations.json").read_text())["MESM_reg_5"]
ANNOTATIONS = sorted(
    [a for a in ALL_ANNOTATIONS if a.get("markerSet") == "manual_entry1" and a.get("action") in ("Buy", "Sell")],
    key=lambda a: a["barIndex"],
)

def dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

def in_session(value):
    t = value.split("T")[1].replace("Z", "")
    return "06:30:00" <= t <= "14:00:00"

def direction_points(entry, bar, action):
    return (bar["high"] - entry) if action == "Buy" else (entry - bar["low"])

def adverse_points(entry, bar, action):
    return (entry - bar["low"]) if action == "Buy" else (bar["high"] - entry)

def independent(a, brick):
    entry = DATA[a["barIndex"]]["close"]
    target = brick
    stop = brick * 2
    for i in range(a["barIndex"] + 1, len(DATA)):
        b = DATA[i]
        if b["time"].split("T")[0] != a["timestamp"].split("T")[0] or not in_session(b["time"]):
            break
        favorable = direction_points(entry, b, a["action"])
        adverse = adverse_points(entry, b, a["action"])
        # Favorable-first is the established convention for same-bar threshold hits.
        if favorable >= target:
            return {"outcome": "Win", "bars": i - a["barIndex"], "minutes": (dt(b["time"]) - dt(a["timestamp"])).total_seconds() / 60}
        if adverse >= stop:
            return {"outcome": "Loss", "bars": i - a["barIndex"], "minutes": (dt(b["time"]) - dt(a["timestamp"])).total_seconds() / 60}
    return {"outcome": "Pending", "bars": None, "minutes": None}

def campaign(date, signals, brick, stop_bricks=2.0, recovery_stop_bricks=None):
    profit = 0.0
    trades, ignored = [], 0
    next_entry = -1
    for a in signals:
        if profit >= brick:
            break
        idx = a["barIndex"]
        if idx <= next_entry:
            ignored += 1
            continue
        entry = DATA[idx]["close"]
        recovery = profit < 0
        target = -profit if recovery else brick
        active_stop_bricks = (
            recovery_stop_bricks
            if recovery and recovery_stop_bricks is not None
            else stop_bricks
        )
        stop = brick * active_stop_bricks
        protected = False
        exit_i = None
        result = "Pending"
        pnl = 0.0
        for i in range(idx + 1, len(DATA)):
            b = DATA[i]
            if b["time"].split("T")[0] != date or not in_session(b["time"]):
                break
            favorable, adverse = direction_points(entry, b, a["action"]), adverse_points(entry, b, a["action"])
            if not recovery:
                if favorable >= target:
                    exit_i, pnl, result = i, target, "Target"
                    break
                if adverse >= stop:
                    exit_i, pnl, result = i, -stop, "Stop"
                    break
                continue

            opposite = ((a["action"] == "Buy" and b["close"] < b["open"]) or
                        (a["action"] == "Sell" and b["close"] > b["open"]))
            current = (b["close"] - entry) * (1 if a["action"] == "Buy" else -1)
            touched_entry = adverse >= 0

            if not protected:
                if favorable >= target:
                    exit_i, pnl, result = i, target, "RecoveryZero"
                    break
                if favorable >= brick:
                    if current <= 0:
                        exit_i, pnl, result = i, 0.0, "ProtectedBreakeven"
                        break
                    if opposite:
                        exit_i, pnl, result = i, current, "OppositeClose"
                        break
                    protected = True
                    continue
                if adverse >= stop:
                    exit_i, pnl, result = i, -stop, "Stop"
                    break
                continue

            if favorable >= target:
                exit_i, pnl, result = i, target, "RecoveryZero"
                break
            if touched_entry:
                exit_i, pnl, result = i, 0.0, "ProtectedBreakeven"
                break
            if opposite:
                exit_i, pnl, result = i, current, "OppositeClose"
                break
        if exit_i is None:
            # Close an open position on the final bar of the regular session.
            session_bars = [j for j, b in enumerate(DATA) if b["time"].split("T")[0] == date and in_session(b["time"])]
            if not session_bars:
                continue
            exit_i = session_bars[-1]
            pnl = (DATA[exit_i]["close"] - entry) * (1 if a["action"] == "Buy" else -1)
            result = "SessionEnd"
        profit += pnl
        trades.append({"entry": a, "exit_i": exit_i, "pnl": pnl, "result": result})
        next_entry = exit_i
    max_dd = 0.0
    running = 0.0
    for t in trades:
        running += t["pnl"]
        max_dd = min(max_dd, running)
    first_entry = DATA[signals[0]["barIndex"]]["time"] if signals else None
    done = DATA[trades[-1]["exit_i"]]["time"] if profit >= brick and trades else None
    elapsed = (dt(done) - dt(first_entry)).total_seconds() / 60 if done and first_entry else None
    return {"profit": profit, "trades": trades, "ignored": ignored, "max_dd": max_dd, "first_entry": first_entry, "done": done, "elapsed": elapsed}

brick = max(Counter(round(b["high"] - b["low"], 10) for b in DATA if b["high"] > b["low"]).items(), key=lambda x: x[1])[0]
by_date = defaultdict(list)
for a in ANNOTATIONS:
    if in_session(a["timestamp"]):
        by_date[a["timestamp"].split("T")[0]].append(a)

rows = []
for date in sorted(by_date):
    sigs = by_date[date]
    outcomes = [independent(a, brick) for a in sigs]
    c = campaign(date, sigs, brick)
    wins = sum(o["outcome"] == "Win" for o in outcomes)
    losses = sum(o["outcome"] == "Loss" for o in outcomes)
    difficulty = (len(c["trades"]), max(0, -c["max_dd"]), c["elapsed"] or 9999, len(sigs))
    rows.append({"date": date, "signals": len(sigs), "ind_wins": wins, "ind_losses": losses, "trades": len(c["trades"]), "result": "Win" if c["profit"] >= brick else "Not reached", "bars": c["profit"] / brick, "dd": c["max_dd"] / brick, "elapsed": c["elapsed"], "done": c["done"], "ignored": c["ignored"], "difficulty": difficulty})

hard_order = sorted(rows, key=lambda r: r["difficulty"], reverse=True)
def mins(x): return "—" if x is None else f"{x:.1f}"
excluded = len([a for a in ANNOTATIONS if not in_session(a["timestamp"])])
lines = ["# manual_entry1 Day-by-Day Campaign Analysis", "", f"Generated: {datetime.now().isoformat(timespec='seconds')}", "", "## Summary", "", f"- Signal set: `manual_entry1` on `MESM_reg_5`", f"- Session analyzed: 06:30:00–14:00:00", f"- One bar: {brick:.2f} points (5 ticks); adverse threshold: 2 bars", f"- Sessions represented: {len(rows)}; in-session raw signals: {sum(r['signals'] for r in rows)}; executed trades: {sum(r['trades'] for r in rows)}", f"- Campaigns reaching +1 bar: {sum(r['result']=='Win' for r in rows)} / {len(rows)}", f"- Excluded overnight/out-of-window annotations: {excluded}", "", "The campaign stops at +1 bar net. A first trade targets +1 bar and stops at −2 bars; after a loss, recovery targets the remaining daily deficit, with the same −2-bar stop. A profitable opposite-color close is allowed only after recovery protection has armed at +1 bar. Open trades are closed at the end of the regular session.", "", "## Daily Breakdown", "", "| Date | Result | Raw signals | Executed trades | Independent +1-bar wins/losses | Net bars | Max DD | Minutes | Done | Difficulty |", "|---|---:|---:|---:|---:|---:|---:|---:|---|---|"]
for r in rows:
    if r["trades"] <= 1 and r["dd"] == 0: cat = "Easy"
    elif r["trades"] <= 3 and r["dd"] > -2: cat = "Moderate"
    elif r["trades"] <= 10: cat = "Hard"
    else: cat = "Very hard"
    lines.append(f"| {r['date']} | {r['result']} | {r['signals']} | {r['trades']} | {r['ind_wins']}/{r['ind_losses']} | {r['bars']:.1f} | {r['dd']:.1f} | {mins(r['elapsed'])} | {r['done'].split('T')[1] if r['done'] else '—'} | {cat} |")
lines += ["", "## Hardest Sessions", "", "Ranked first by executed trades, then drawdown, duration, and raw signal count:", ""]
hard_rows = [r for r in hard_order if r["difficulty"] > (1, 0, 9999, 1)]
for i, r in enumerate(hard_rows, 1):
    lines.append(f"{i}. **{r['date']}** — {r['trades']} trades, {r['dd']:.1f}-bar max drawdown, {mins(r['elapsed'])} minutes, {r['signals']} raw signals.")
lines += ["", "## Interpretation", "", "- `Raw signals` counts every directional annotation that occurred in-session.", "- `Executed trades` excludes signals that arrived while the preceding trade was still active or after the daily target was reached.", "- Difficulty is operational: trade count is the primary measure, with drawdown and time as tie-breakers. Independent signal win/loss counts show whether a difficult day was caused by entry quality or by recovery sequencing.", ""]
(ROOT / "scratch/manual-entry1-daily-analysis.md").write_text("\n".join(lines))
print(ROOT / "scratch/manual-entry1-daily-analysis.md")
print("rows", len(rows), "signals", sum(r["signals"] for r in rows), "trades", sum(r["trades"] for r in rows))
