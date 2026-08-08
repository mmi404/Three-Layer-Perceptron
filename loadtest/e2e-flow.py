#!/usr/bin/env python3
"""
End-to-end booking flow against a running stack, exercising the gateway's
documented misbehaviour on purpose via the X-Debug-Force passthrough header.

    python loadtest/e2e-flow.py [BASE_URL]

Covers:
    A. clean success
    B. duplicate callback  (the 8% case, forced) -> must confirm exactly once
    C. race                (callback lands before /charge returns)
    D. failed payment      (the 10% case, forced) -> seats must be released

The OTP code is only ever printed to the gateway container's stdout — that is
how the provided gateway works, there is no delivery channel to us — so this
script scrapes it from `docker compose logs gateway`.
"""
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {}


def wait_for_api(attempts=30):
    for _ in range(attempts):
        try:
            code, _ = req("GET", "/health")
            if code == 200:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def otp_for(ref, tries=20):
    """Scrape the delivered OTP out of the gateway's logs."""
    for _ in range(tries):
        logs = subprocess.run(
            ["docker", "compose", "logs", "gateway", "--tail", "400"],
            capture_output=True, text=True,
        ).stdout
        m = re.search(rf"OTP\s+ref={re.escape(ref)}\s+code=(\d+)", logs)
        if m:
            return m.group(1)
        time.sleep(1)
    return None


def settle(ref, timeout_s=40):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        _, b = req("GET", f"/api/v1/bookings/{ref}")
        if b.get("status") in ("CONFIRMED", "FAILED", "EXPIRED"):
            return b, time.time() - t0
        time.sleep(0.5)
    return None, time.time() - t0


def flow(showtime, seat, force, label, expect):
    print(f"\n--- {label}  (seat {seat['label']}) ---")

    code, hold = req("POST", "/api/v1/holds", {
        "showtime_id": showtime, "seat_ids": [seat["seat_id"]],
        "phone": "+8801799900011",
    })
    if code != 201:
        print(f"  FAIL hold: HTTP {code} {hold}")
        return False
    ref = hold["booking_ref"]
    print(f"  hold        HTTP 201  ref={ref}  expires={hold['expires_at']}")

    # The gateway drops ~10% of OTPs deliberately; resend until one lands.
    otp = None
    for attempt in range(3):
        sc, _ = req("POST", f"/api/v1/bookings/{ref}/otp/send")
        if sc != 202:
            print(f"  otp/send    HTTP {sc}  <-- send itself was rejected")
            break
        otp = otp_for(ref, tries=8)
        if otp:
            break
        print(f"  otp         not delivered (10% chaos), resending [{attempt + 1}]")
    if not otp:
        print("  FAIL: no OTP after 3 sends")
        return False
    print(f"  otp         delivered code={otp}")

    vc, _ = req("POST", f"/api/v1/bookings/{ref}/otp/verify", {"code": otp})
    print(f"  otp/verify  HTTP {vc}")

    t0 = time.time()
    pc, pr = req("POST", f"/api/v1/bookings/{ref}/pay", None,
                 {"X-Debug-Force": force} if force else None)
    print(f"  pay         HTTP {pc} in {(time.time() - t0) * 1000:.0f}ms "
          f"(must not wait for the gateway)")
    if pc not in (202, 503):
        print(f"  FAIL pay: {pr}")
        return False
    if pc == 503:
        print("  gateway refused the charge; seats released")
        return expect == "FAILED"

    booking, took = settle(ref)
    if not booking:
        print(f"  FAIL: never settled after {took:.0f}s")
        return False
    print(f"  settled     {booking['status']} / payment={booking['payment_status']} "
          f"after {took:.1f}s")

    ok = booking["status"] == expect
    print(f"  expected    {expect}  ->  {'PASS' if ok else 'FAIL'}")
    return ok


def main():
    if not wait_for_api():
        print("API never became healthy")
        return 1

    showtime = req("GET", "/api/v1/movies")[1]["data"][0]["showtimes"][0]["id"]
    smap = req("GET", f"/api/v1/showtimes/{showtime}/seats")[1]
    free = [s for s in smap["seats"] if s["status"] == "available"]
    if len(free) < 4:
        print("Not enough free seats; re-seed the database")
        return 1

    print(f"showtime {showtime}  ({smap['showtime']['movie_title']})")
    print(f"available seats: {smap['summary']['available']}")

    results = [
        flow(showtime, free[0], "success",   "A. clean success", "CONFIRMED"),
        flow(showtime, free[1], "duplicate", "B. DUPLICATE callback (8% case, forced)", "CONFIRMED"),
        flow(showtime, free[2], "race",      "C. RACE: callback before /charge returns", "CONFIRMED"),
        flow(showtime, free[3], "fail",      "D. FAILED payment (10% case, forced)", "FAILED"),
    ]

    # A failed payment must give the seat back.
    after = req("GET", f"/api/v1/showtimes/{showtime}/seats")[1]
    failed_seat = next(s for s in after["seats"] if s["label"] == free[3]["label"])
    released = failed_seat["status"] == "available"
    print(f"\n  seat {failed_seat['label']} after failed payment: "
          f"{failed_seat['status']}  ->  {'PASS' if released else 'FAIL'}")
    results.append(released)

    print(f"\n=== {sum(results)}/{len(results)} passed ===")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
