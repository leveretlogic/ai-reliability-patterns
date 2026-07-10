# Heartbeat freshness check

"Is anything actually running?" - a check on the *absence* of activity, scoped to the windows when activity is expected.

## The problem

A scheduler that has stopped firing looks identical to one that has nothing to do. Both produce zero events. Most monitoring detects errors, not silence - so a cron that quietly broke at 02:00 will keep "looking fine" until someone notices a missing report at 11:00.

## What this pattern does

- Reads the `lastRunAt` timestamp from each scheduled job's state and finds the freshest one.
- Compares its age to a **business-hour window** - silence at 04:00 is normal; silence at 10:00 is an outage.
- Tiered escalation: open an incident at 2h stale, send a direct out-of-band alert at 3h stale.
- Idempotent - safe to run on every coordinator cycle. Re-emitting is prevented via a dedup key that clears on recovery.

## When to use it

- Any periodic system whose value depends on it actually firing: cron schedulers, agent turn loops, polling workers, ETL pipelines.
- Multi-tenant / multi-job setups where you only need *one* job to have run recently - that's enough proof of life.

## When not to use it

- Event-driven systems where idle is genuinely the steady state.
- Systems with sub-minute SLAs - this pattern is tuned for "hours stale", not "seconds stale".

## Reference

- [`heartbeat-freshness.ts`](./heartbeat-freshness.ts) - freshest-job lookup, business-hour gate, tiered escalation.

## Lineage

This check ran in Mission Control v1's coordinator loop. v1's deeper lesson was that one freshness check isn't enough: the dashboard [reported green for 3 weeks while its data pipeline was dead](https://github.com/leveretlogic/agent-mission-control#v1-died-twice-thats-the-interesting-part), because freshness lived in a single place that could fail. v2 makes staleness ambient instead of centralised - every panel renders the age of the data it shows (file mtimes), and `/api/health` exposes the index age so an external monitor can alert on it. Use this pattern when you have a fleet of scheduled jobs to watch from one place; pair it with per-surface staleness so no single check is load-bearing.
