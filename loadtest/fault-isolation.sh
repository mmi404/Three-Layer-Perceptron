#!/usr/bin/env bash
# =============================================================================
#  BONUS: Fault isolation.
#
#      ./loadtest/fault-isolation.sh [BASE_URL]
#
#  With the gateway container stopped completely:
#    - browsing, seat maps and holds still work
#    - /health stays green and fast
#    - payment endpoints degrade to 503, never 500
#    - a circuit breaker stops us waiting on a dependency that cannot answer
#    - everything recovers when the gateway comes back
#
#  The design reason this works: `api` has no depends_on for `gateway`, and
#  nothing on the browse/hold path imports the gateway client at all.
# =============================================================================
set -uo pipefail

B="${1:-http://localhost:8080}"
pass=0
fail=0

ok()   { printf "  %-46s %-10s PASS\n" "$1" "$2"; pass=$((pass + 1)); }
bad()  { printf "  %-46s %-10s FAIL (want %s)\n" "$1" "$2" "$3"; fail=$((fail + 1)); }
chk()  { if [ "$2" = "$3" ]; then ok "$1" "$3"; else bad "$1" "$3" "$2"; fi; }
faster_than() { # faster_than <label> <seconds> <actual>
  if awk "BEGIN{exit !($3 < $2)}"; then ok "$1" "${3}s"; else bad "$1" "${3}s" "<${2}s"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' -m 15 "$@"; }
secs() { curl -s -o /dev/null -w '%{time_total}' -m 15 "$@"; }

pick_seat() {
  curl -s "$B/api/v1/showtimes/$1/seats" | python -c \
    "import sys,json;print([s['seat_id'] for s in json.load(sys.stdin)['seats'] if s['status']=='available'][0])"
}
make_hold() {
  curl -s -X POST "$B/api/v1/holds" -H 'Content-Type: application/json' \
    -d "{\"showtime_id\":\"$1\",\"seat_ids\":[\"$2\"],\"phone\":\"$3\"}" \
    | python -c "import sys,json;print(json.load(sys.stdin).get('booking_ref',''))"
}

ST=$(curl -s "$B/api/v1/movies" \
  | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['showtimes'][0]['id'])")

echo "=============================================================="
echo "FAULT ISOLATION - gateway stopped"
echo "=============================================================="
echo "Stopping the gateway container..."
docker compose stop gateway >/dev/null 2>&1
sleep 2
echo

echo "READ PATH (must be completely unaffected)"
chk "GET /health" 200 "$(code "$B/health")"
chk "GET /ready" 200 "$(code "$B/ready")"
chk "GET /api/v1/movies" 200 "$(code "$B/api/v1/movies")"
chk "GET /api/v1/showtimes/:id/seats" 200 "$(code "$B/api/v1/showtimes/$ST/seats")"
faster_than "/health responds in under 1s" 1.0 "$(secs "$B/health")"
echo

echo "WRITE PATH (holds never touch the gateway)"
SEAT=$(pick_seat "$ST")
RESP=$(curl -s -w '\n%{http_code}' -X POST "$B/api/v1/holds" -H 'Content-Type: application/json' \
  -d "{\"showtime_id\":\"$ST\",\"seat_ids\":[\"$SEAT\"],\"phone\":\"+8801799988877\"}")
chk "POST /api/v1/holds" 201 "$(echo "$RESP" | tail -1)"
REF=$(echo "$RESP" | head -1 | python -c "import sys,json;print(json.load(sys.stdin).get('booking_ref',''))" 2>/dev/null)
echo

echo "PAYMENT PATH (degrades to 503, never 500)"
chk "POST otp/send -> 503 not 500" 503 "$(code -X POST "$B/api/v1/bookings/$REF/otp/send")"

# Each call to a container that no longer resolves costs ~4s of DNS timeout.
# The breaker opens on the 3rd consecutive failure, so calls 1-3 are slow and
# everything after that fails instantly instead of tying up a request slot.
echo "    latency per attempt (breaker opens on the 3rd failure):"
for i in 2 3 4 5; do
  printf "      attempt %s: %ss\n" "$i" "$(secs -X POST "$B/api/v1/bookings/$REF/otp/send")"
done
T_AFTER=$(secs -X POST "$B/api/v1/bookings/$REF/otp/send")
faster_than "after trip, calls fail fast" 0.5 "$T_AFTER"
chk "still a 503, not a 500, while open" 503 "$(code -X POST "$B/api/v1/bookings/$REF/otp/send")"
# /pay answers 409, not 503, and that is correct: OTP was never verified, so we
# reject on our own state before ever dialling a dead gateway.
chk "POST pay -> rejected on our own state" 409 "$(code -X POST "$B/api/v1/bookings/$REF/pay")"
echo

echo "RECOVERY"
docker compose start gateway >/dev/null 2>&1
for _ in $(seq 1 25); do
  [ "$(code http://localhost:9000/health)" = "200" ] && break
  sleep 1
done
chk "gateway /health" 200 "$(code http://localhost:9000/health)"
chk "our /ready" 200 "$(code "$B/ready")"
# Wait out the breaker cooldown, then prove the whole path works again.
sleep 11
SEAT2=$(pick_seat "$ST")
REF2=$(make_hold "$ST" "$SEAT2" "+8801799988878")
chk "POST otp/send after recovery" 202 "$(code -X POST "$B/api/v1/bookings/$REF2/otp/send")"
echo

echo "=============================================================="
echo "  $pass passed, $fail failed"
echo "=============================================================="
[ "$fail" -eq 0 ]
