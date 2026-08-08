#!/usr/bin/env python3
"""
SCENARIO C - Find your breakpoint.  (BONUS)

    python loadtest/scenario-c.py [BASE_URL] [--writes]

Ramps concurrent virtual users against the seat map (and optionally the hold
endpoint) until the system degrades, then reports where p95 turns upward and
where errors begin.

IMPORTANT, from the problem statement: do not run this on the same machine as
the application. If the load generator and the API share two vCPUs you are
measuring the load generator competing with the service. Run it from your
laptop against the deployed URL.

    python loadtest/scenario-c.py http://<ec2-public-ip>

This is deliberately a THROUGHPUT test, not a contention test. Scenario A
already proves correctness under contention; here we want to find the resource
that runs out first, so writes are spread across distinct seats rather than
fighting over one.

The number on its own means nothing. What earns marks is the explanation of
WHICH resource ran out, so the report ends with the evidence you need to make
that argument.
"""
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://localhost:8080"
WRITES = False
for a in sys.argv[1:]:
    if a == "--writes":
        WRITES = True
    else:
        BASE = a

STAGES = [5, 10, 20, 40, 80, 120, 160, 220]
STAGE_SECONDS = 12


def get_json(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.load(r)


def timed_get(path):
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(BASE + path, timeout=30) as r:
            r.read()
            return time.perf_counter() - t0, r.status
    except urllib.error.HTTPError as e:
        e.read()
        return time.perf_counter() - t0, e.code
    except Exception:
        return time.perf_counter() - t0, 0


def timed_hold(showtime, seat_id, tag):
    body = json.dumps({
        "showtime_id": showtime, "seat_ids": [seat_id], "phone": f"+88017{tag:08d}",
    }).encode()
    req = urllib.request.Request(
        BASE + "/api/v1/holds", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
            return time.perf_counter() - t0, r.status
    except urllib.error.HTTPError as e:
        e.read()
        return time.perf_counter() - t0, e.code
    except Exception:
        return time.perf_counter() - t0, 0


def pct(xs, p):
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(int(len(s) * p / 100), len(s) - 1)] * 1000


def run_stage(vus, showtime, seats):
    """Hammer for STAGE_SECONDS with `vus` workers, return latencies + codes."""
    stop = time.time() + STAGE_SECONDS
    lats, codes = [], []
    counter = [0]

    def worker(wid):
        local_l, local_c = [], []
        i = 0
        while time.time() < stop:
            if WRITES and i % 5 == 4:
                counter[0] += 1
                seat = seats[(wid * 7 + i) % len(seats)]
                lat, code = timed_hold(showtime, seat, counter[0])
            else:
                lat, code = timed_get(f"/api/v1/showtimes/{showtime}/seats")
            local_l.append(lat)
            local_c.append(code)
            i += 1
        return local_l, local_c

    with ThreadPoolExecutor(max_workers=vus) as pool:
        for l, c in pool.map(worker, range(vus)):
            lats.extend(l)
            codes.extend(c)
    return lats, codes


def main():
    movies = get_json("/api/v1/movies")["data"]
    premiere = next((m for m in movies if m.get("is_premiere")), movies[0])
    showtime = premiere["showtimes"][0]["id"]
    smap = get_json(f"/api/v1/showtimes/{showtime}/seats")
    seats = [s["seat_id"] for s in smap["seats"]]

    print("=" * 78)
    print("SCENARIO C - find the breakpoint")
    print("=" * 78)
    print(f"  target      : {BASE}")
    print(f"  showtime    : {showtime} ({premiere['title']})")
    print(f"  mix         : {'80% seat-map reads / 20% holds' if WRITES else '100% seat-map reads'}")
    print(f"  stage length: {STAGE_SECONDS}s")
    if "localhost" in BASE or "127.0.0.1" in BASE:
        print()
        print("  WARNING: running against localhost. The load generator is competing")
        print("  with the application for the same CPUs, so these numbers describe")
        print("  your laptop, not the service. Use the deployed URL for real results.")
    print()
    print(f"  {'VUs':>4}  {'req/s':>8}  {'p50 ms':>8}  {'p95 ms':>8}  {'p99 ms':>8}  {'err%':>6}  {'non-2xx':>18}")
    print(f"  {'-'*4}  {'-'*8}  {'-'*8}  {'-'*8}  {'-'*8}  {'-'*6}  {'-'*18}")

    rows = []
    for vus in STAGES:
        lats, codes = run_stage(vus, showtime, seats)
        n = len(lats)
        rps = n / STAGE_SECONDS
        p50, p95, p99 = pct(lats, 50), pct(lats, 95), pct(lats, 99)
        # 409 is a correct answer under write load, not an error.
        errs = [c for c in codes if c == 0 or c >= 500]
        err_pct = 100.0 * len(errs) / n if n else 0
        odd = {}
        for c in codes:
            if c not in (200, 201, 409):
                odd[c] = odd.get(c, 0) + 1
        rows.append((vus, rps, p50, p95, p99, err_pct))
        print(f"  {vus:>4}  {rps:>8.1f}  {p50:>8.1f}  {p95:>8.1f}  {p99:>8.1f}  {err_pct:>6.2f}  {str(odd) if odd else '-':>18}")
        time.sleep(2)

    print()
    print("ANALYSIS")

    # The knee: first stage where p95 grows faster than throughput does.
    baseline_p95 = rows[0][3] or 1
    knee = None
    for i in range(1, len(rows)):
        if rows[i][3] > baseline_p95 * 3 and rows[i][1] < rows[i - 1][1] * 1.15:
            knee = rows[i]
            break
    first_err = next((r for r in rows if r[5] > 1.0), None)
    peak = max(rows, key=lambda r: r[1])

    print(f"  peak throughput        : {peak[1]:.1f} req/s at {peak[0]} VUs")
    if knee:
        print(f"  p95 knee               : {knee[0]} VUs "
              f"(p95 {knee[3]:.0f} ms vs {baseline_p95:.0f} ms baseline, "
              f"throughput stopped scaling)")
    else:
        print("  p95 knee               : not reached within the tested range")
    if first_err:
        print(f"  errors begin           : {first_err[0]} VUs ({first_err[5]:.2f}%)")
    else:
        print("  errors begin           : no 5xx or transport errors at any stage")

    print()
    print("EVIDENCE TO COLLECT FOR THE BOTTLENECK ARGUMENT")
    print("  Run these on the server WHILE the top stage is executing:")
    print("    docker stats --no-stream                 # CPU/memory per container")
    print("    docker compose exec postgres psql -U app -d cinemaseat -c \\")
    print("      \"SELECT state, count(*) FROM pg_stat_activity GROUP BY state;\"")
    print("    curl -s $BASE/metrics | grep -E 'process_cpu|nodejs_eventloop_lag_seconds'")
    print()
    print("  Read them like this:")
    print("    pg_stat_activity full at ~10/replica ...... connection pool exhausted")
    print("    postgres CPU pinned, api CPU idle ......... database-bound")
    print("    api CPU pinned, eventloop lag climbing .... blocked event loop")
    print("    both idle but latency high ................ waiting on row locks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
