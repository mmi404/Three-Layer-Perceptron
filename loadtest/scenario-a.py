#!/usr/bin/env python3
"""
SCENARIO A — One seat, many buyers.  (REQUIRED)

    python loadtest/scenario-a.py [BASE_URL] [CONCURRENCY]

Fires N genuinely concurrent hold requests at ONE seat on ONE showtime, in a
single burst. Exactly one must succeed; the rest must be cleanly rejected.
Oversell must be zero.

Spreading users across many seats would show zero collisions and prove
nothing, so this deliberately makes the seats fight.

Run this from your laptop against the DEPLOYED url, never on the server —
otherwise you are measuring the load generator competing with the application
for the same two vCPUs.

k6 equivalent: loadtest/scenario-a.js (same test, nicer percentiles).
"""
import collections
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 100


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return json.load(r)


def hold(showtime, seat_id, i):
    body = json.dumps({
        "showtime_id": showtime,
        "seat_ids": [seat_id],
        "phone": f"+8801700{i:05d}",
    }).encode()
    req = urllib.request.Request(
        BASE + "/api/v1/holds", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r).get("booking_ref"), time.time() - t0
    except urllib.error.HTTPError as e:
        try:
            code = json.load(e).get("error", {}).get("code")
        except Exception:
            code = None
        return e.code, code, time.time() - t0
    except Exception as e:
        return 0, type(e).__name__, time.time() - t0


def main():
    movies = get("/api/v1/movies")["data"]
    premiere = next((m for m in movies if m.get("is_premiere")), movies[0])
    showtime = premiere["showtimes"][0]["id"]

    smap = get(f"/api/v1/showtimes/{showtime}/seats")
    # Prefer F12 — the seat from the problem statement. Any free seat will do.
    target = next((s for s in smap["seats"] if s["label"] == "F12"
                   and s["status"] == "available"), None)
    if target is None:
        target = next((s for s in smap["seats"] if s["status"] == "available"), None)
    if target is None:
        print("No available seat. Re-seed or pick another showtime.")
        return 1

    print("=" * 66)
    print("SCENARIO A - one seat, many buyers")
    print("=" * 66)
    print(f"  target        : {BASE}")
    print(f"  movie         : {premiere['title']}")
    print(f"  showtime      : {showtime}")
    print(f"  contended seat: {target['label']}  ({target['seat_id']})")
    print(f"  concurrency   : {N} simultaneous requests, single burst")
    print()

    # Every request is dispatched before any is awaited. A sequential loop
    # would not contend and would prove nothing.
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=N) as pool:
        futures = [pool.submit(hold, showtime, target["seat_id"], i) for i in range(N)]
        results = [f.result() for f in futures]
    wall = time.time() - t0

    codes = collections.Counter(r[0] for r in results)
    latencies = sorted(r[2] for r in results)
    winners = [r[1] for r in results if r[0] == 201]

    def pct(p):
        return latencies[min(int(len(latencies) * p / 100), len(latencies) - 1)] * 1000

    print("RESULTS")
    print(f"  requests sent      : {N}")
    print(f"  successful holds   : {codes.get(201, 0)}")
    print(f"  rejected (409)     : {codes.get(409, 0)}")
    other = {k: v for k, v in codes.items() if k not in (201, 409)}
    print(f"  other responses    : {other if other else 'none'}")
    print(f"  winning booking_ref: {winners[0] if winners else 'NONE'}")
    print()
    print(f"  wall clock         : {wall * 1000:.0f} ms")
    print(f"  latency p50/p95/max: {pct(50):.0f} / {pct(95):.0f} / {latencies[-1] * 1000:.0f} ms")
    print()

    # Independent verification: ask the seat map, do not trust our own tally.
    after = get(f"/api/v1/showtimes/{showtime}/seats")
    seat_after = next(s for s in after["seats"] if s["seat_id"] == target["seat_id"])
    held_count = 1 if seat_after["status"] in ("held", "booked") else 0
    oversell = max(0, len(winners) - 1)

    print("VERIFICATION (from the seat map, not from our own counters)")
    print(f"  seat {target['label']} status     : {seat_after['status']}")
    print(f"  times seat is held : {held_count}")
    print(f"  OVERSELL           : {oversell}")
    print()

    ok = (codes.get(201, 0) == 1 and codes.get(409, 0) == N - 1
          and not other and oversell == 0 and held_count == 1)
    print("  RESULT:", "PASS" if ok else "FAIL")
    print("=" * 66)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
