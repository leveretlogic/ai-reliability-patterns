# Health watchdog (with side-channel escalation)

A liveness check for a critical dependency, with two non-obvious properties: it tolerates one transient blip, and it escalates over a path that bypasses the very thing it's checking.

## The problem

Most "health check" implementations fail at the worst possible moment because they share infrastructure with the system they're monitoring:

- The gateway is down → the alert pipeline routes through the gateway → the alert never fires.
- The first failed probe gets paged on → the operator now has alert fatigue from every transient blip.
- A flapping dependency emits 200 incidents in 3 hours because nothing dedupes.

## What this pattern does

- Counts **consecutive** failures (not failure rate over a window). One miss is a blip; three in a row is an outage.
- Emits an incident only the first time the threshold is crossed (dedup), and clears the dedup state on recovery.
- Escalates via a **side channel** — e.g., direct Telegram/SMS — that does not depend on the failed component. If the gateway is dead, the alert path must not go through the gateway.
- Rate-limits side-channel alerts (default: at most one per hour) so a long outage doesn't become a notification storm.

## When to use it

- Watchdogs for the critical path of an agent system: gateway, scheduler, primary database.
- Anywhere you need to alert on the absence of a thing rather than the presence of an error.

## When not to use it

- Checks that are themselves cheap and frequent enough that a single failure is action-worthy (e.g., user-facing latency probes).
- Fast-moving metrics — this is a "is it alive at all" check, not an SLO tracker.

## Reference

- [`health-watchdog.ts`](./health-watchdog.ts) — consecutive-failure counter, dedup, side-channel escalation, rate limiting.
- See it in production: [Mission Control · `scripts/coordinator-loop.mjs` `checkGatewayHealth`](https://github.com/leveretlogic/agent-mission-control/blob/main/scripts/coordinator-loop.mjs).
