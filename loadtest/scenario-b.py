#!/usr/bin/env python3
"""
SCENARIO B — The abandoned hold.  (REQUIRED)

    HOLD_TTL_SECONDS=10 docker compose up -d
    python loadtest/scenario-b.py [BASE_URL]

Buyer 1 holds a seat and walks away without paying. We watch the hold expire,
confirm the seat returns to available, and then have Buyer 2 successfully book
the very same seat.

Prints an observed timeline, not a claim.

Note the design point this demonstrates: expiry is enforced LAZILY inside the
hold query's WHERE clause, so the seat becomes claimable the instant its
deadline passes. The background sweeper only updates the seat map for
onlookers. Stop the worker container and re-run this — buyer 2 still wins.
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
T0 = time.time()


def stamp():
    return f"T+{time.time() - T0:6.1f}s"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        BASE + path, data=data,
        headers={"Content-Type": "application/json"}, method=method,
    )
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {}


def seat_status(showtime, seat_id):
    _, m = req("GET", f"/api/v1/showtimes/{showtime}/seats")
    return next(s for s in m["seats"] if s["seat_id"] == seat_id)["status"]


def main():
    _, movies = req("GET", "/api/v1/movies")
    premiere = next((m for m in movies["data"] if m.get("is_premiere")), movies["data"][0])
    showtime = premiere["showtimes"][0]["id"]

    _, smap = req("GET", f"/api/v1/showtimes/{showtime}/seats")
    seat = next((s for s in smap["seats"] if s["status"] == "available"), None)
    if not seat:
        print("No available seat; re-seed the database.")
        return 1

    print("=" * 66)
    print("SCENARIO B - the abandoned hold")
    print("=" * 66)
    print(f"  target   : {BASE}")
    print(f"  showtime : {showtime}  ({premiere['title']})")
    print(f"  seat     : {seat['label']}")
    print()
    print("TIMELINE")
    print(f"  {stamp()}  seat {seat['label']} is {seat['status']}")

    code, hold = req("POST", "/api/v1/holds", {
        "showtime_id": showtime, "seat_ids": [seat["seat_id"]],
        "phone": "+8801700000001",
    })
    if code != 201:
        print(f"  FAILED to hold: HTTP {code} {hold}")
        return 1
    expires_at = hold["expires_at"]
    ttl = hold["hold_ttl_seconds"]
    print(f"  {stamp()}  buyer 1 holds it   ref={hold['booking_ref']}")
    print(f"  {stamp()}  HOLD_TTL_SECONDS={ttl}, expires_at={expires_at}")

    print(f"  {stamp()}  seat is now {seat_status(showtime, seat['seat_id'])}")

    # Buyer 2 tries too early and must be refused.
    code2, body2 = req("POST", "/api/v1/holds", {
        "showtime_id": showtime, "seat_ids": [seat["seat_id"]],
        "phone": "+8801700000002",
    })
    print(f"  {stamp()}  buyer 2 tries early -> HTTP {code2} "
          f"({body2.get('error', {}).get('code', '')})")

    print(f"  {stamp()}  buyer 1 walks away. waiting for expiry...")

    deadline = time.time() + ttl + 20
    released_at = None
    while time.time() < deadline:
        if seat_status(showtime, seat["seat_id"]) == "available":
            released_at = time.time() - T0
            break
        time.sleep(0.5)

    if released_at is None:
        print(f"  {stamp()}  FAILED: seat never returned to available")
        return 1

    print(f"  {stamp()}  seat returned to AVAILABLE")

    code3, hold3 = req("POST", "/api/v1/holds", {
        "showtime_id": showtime, "seat_ids": [seat["seat_id"]],
        "phone": "+8801700000002",
    })
    print(f"  {stamp()}  buyer 2 holds it   -> HTTP {code3} "
          f"ref={hold3.get('booking_ref')}")

    _, first = req("GET", f"/api/v1/bookings/{hold['booking_ref']}")
    print(f"  {stamp()}  buyer 1's booking is now {first.get('status')}")

    print()
    ok = code2 == 409 and code3 == 201 and first.get("status") == "EXPIRED"
    print("RESULTS")
    print(f"  buyer 2 refused while hold was live : {'yes' if code2 == 409 else 'NO'}")
    print(f"  seat released after                 : {released_at:.1f}s (TTL {ttl}s)")
    print(f"  buyer 2 booked the same seat        : {'yes' if code3 == 201 else 'NO'}")
    print(f"  buyer 1's booking marked EXPIRED    : {'yes' if first.get('status') == 'EXPIRED' else 'NO'}")
    print()
    print("  RESULT:", "PASS" if ok else "FAIL")
    print("=" * 66)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
