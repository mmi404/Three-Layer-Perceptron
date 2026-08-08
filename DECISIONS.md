# Decisions

Three things we genuinely argued about, what we chose, and what it cost us.

---

## 1. Where seat contention gets resolved

**The argument.** The whole problem is "100 people want seat F12 and exactly one may get it." Everything else follows from where that decision is made. We went back and forth on this for most of the design window because it determines the shape of the entire system.

**Options we considered**

| Option | Case for | Case against |
|---|---|---|
| **Redis `SET NX` distributed lock** per seat | Fast. Contention never reaches Postgres. The obvious "scalable" answer. | Two sources of truth. If Redis restarts, evicts a key under `maxmemory`, or a lock TTL expires while the holder is still working, the lock and the database disagree — and the way that disagreement shows up is a double-booked seat. Correctness would depend on a cache. |
| **Application-level mutex / in-process queue** | Trivial to write. | Dies the moment there is more than one API replica, which is the first thing we do under load. Not a real option, but we said it out loud to rule it out. |
| **Postgres `SELECT … FOR UPDATE` + guarded `UPDATE`** ← **chosen** | The database already provides exactly this guarantee, transactionally, and it is the same component that stores the answer. One source of truth. Survives Redis being wiped. | Every contended request queues on a row lock, so the p50 for 100 buyers on one seat is ~1 s. All contention lands on the database. |
| **Serializable isolation** | Strongest guarantee available. | Under this exact access pattern it produces serialization failures that we would have to catch and retry, converting a clean `409` into a retry storm. Read Committed plus an explicit row lock gives the same safety with predictable behaviour. |

**What we chose.** Postgres is the single arbiter. Every seat-state change is a guarded `UPDATE` whose `WHERE` clause encodes the legal transition, and `rowcount` is the verdict. We never read a status into JavaScript and then decide.

**What we gave up.** Raw hold latency. Scenario A shows p50 ≈ 1014 ms and p95 ≈ 1415 ms for 100 simultaneous buyers on one seat. That is 100 transactions serialising on a single row, and we think that is the correct thing to happen — a seat is inherently a serial resource. We would rather 100 people wait a second than have two of them get the same seat. We also accepted that Postgres becomes the scaling ceiling; the honest first fix is PgBouncer, then a read replica for the seat map.

**What would change our mind.** If seat maps rather than holds became the bottleneck, we would push reads to a replica before touching the hold path. We would only move contention out of Postgres if a single primary genuinely could not keep up — and then we would use `SELECT … FOR UPDATE SKIP LOCKED` over a partitioned seat inventory, not a cache-based lock.

---

## 2. Whether a hold is its own thing

**The argument.** The obvious model is a `holds` table and a `bookings` table: a hold is temporary, a booking is permanent, they are different concepts. We started there and abandoned it.

**Options we considered**

- **Separate `holds` and `bookings` tables.** Conceptually tidy. But it means a hold becoming a booking is a *move* between tables, and every question ("is this seat taken?") has to consult both and reconcile them. Two tables that must agree about the same fact is the same trap as option 1 above, one layer up. Worse, the failure mode is silent: a row left in `holds` after its booking exists looks exactly like a live hold.
- **A single `bookings` table with a status, where `HELD` simply means "has an expiry"** ← **chosen.** One row, one lifecycle: `HELD → PENDING_PAYMENT → CONFIRMED`, or out to `EXPIRED` / `FAILED`. Seat ownership is one nullable foreign key on `show_seats`. There is no reconciliation because there is nothing to reconcile.
- **Event-sourced seat state.** Perfect audit trail and genuinely appealing for a ticketing system. Rejected on time: deriving current seat state from an event log means either replay on every read or a projection to keep in sync, and we had eight hours.

**What we chose.** The booking *is* the hold. Expiry is `expires_at IS NOT NULL AND expires_at < now()`, checked in the same `WHERE` clause that does the work.

**What we gave up.** A shopping cart spanning multiple showtimes — one booking belongs to exactly one showtime. Also a clean audit trail of every hold ever attempted; we only keep the ones that became bookings. If we needed analytics on abandonment we would add an append-only `hold_attempts` table rather than reintroduce a second live table.

**The bug this decision did not prevent.** Our Scenario B run caught a real gap: when a new buyer claimed a timed-out seat via lazy expiry, the *previous* booking sat at `HELD` until the sweeper caught up. The seat had moved on but the old booking still claimed it. We now expire the previous owner inside the same transaction that takes the seat, so the two can never disagree even for a moment — and it does not wait for the worker.

---

## 3. How the seat map stays live

**The argument.** A premiere rush means hundreds of people staring at the same seat map, wanting instant feedback. WebSockets are the interesting answer and someone wanted to build them.

**Options we considered**

| Option | Case for | Case against |
|---|---|---|
| **WebSocket / SSE push** | Genuinely live. Feels excellent. | Stateful connections behind a load balancer need sticky sessions or a Redis pub/sub fan-out, which is a second delivery system to get right. Under the exact spike we are designing for, thousands of open sockets is a new failure mode on the day we can least afford one. It also makes the API no longer trivially horizontally scalable, which is the property everything else rests on. |
| **Poll every 2 s + a 1 s server-side cache** ← **chosen** | Stateless, so the API scales horizontally with no coordination. Hundreds of pollers on one showtime collapse into roughly one query per second because they share the cache. Fails gracefully — a dropped poll is a poll, not a broken connection. | Up to ~2 s of staleness. A user can click a seat that was taken a second ago. |
| **Poll with no cache** | Simplest. | Every poller becomes a database query. Precisely the wrong behaviour under the traffic spike we are designing for. |

**What we chose.** Polling at 2 s against a Redis-cached seat map with a ~1 s TTL, and the key is busted on **every** seat-state change, so a booking is visible almost immediately rather than up to a TTL later.

**What we gave up.** Instant updates. A user can select a seat someone else just took — and then gets a `409` telling them exactly which seats went. We decided that is acceptable because it is *honest*: the 409 is the same answer they would get in a race regardless of how fresh their map was. A live map reduces how often it happens; it can never eliminate it, because the seat can be taken between the render and the click. Given that the 409 path has to be correct anyway, the extra complexity of push buys polish rather than correctness.

**One thing this made easy.** Because the map is derived from a plain query with lazy expiry baked in, it stays truthful with the worker stopped. A push-based cache would have needed its own invalidation path for expiry events.

---

## Honourable mentions

**Circuit breaker on the gateway.** Not argued about, but worth recording: with the gateway container stopped, every call cost ~4 s of DNS timeout, and each of those occupies a request slot doing work that cannot succeed. A dead dependency was quietly consuming the API's capacity. Three consecutive failures now open the circuit for 10 s — measured 3.14 s → 0.016 s.

**Tagging images by commit rather than `:latest`.** Compose compares image *names* when deciding whether to recreate a container, so a rebuilt `:latest` left the old container running and a deploy looked successful while serving stale code. This cost us real debugging time twice before we understood it. Images are now tagged with the commit SHA, `/health` reports the SHA it was built from, and `deploy.sh` fails loudly if the live version does not match what it just built.

**Not splitting into microservices.** Booking and payment touch the same rows in the same transactions — confirming a payment moves seats to `BOOKED`. Splitting them would have turned a local transaction into a distributed one, and we would have had to build sagas and compensating actions to get back the guarantee Postgres was already giving us for free. We split `api` from `worker` instead, on the sync/async seam, which costs nothing because they share an image.
