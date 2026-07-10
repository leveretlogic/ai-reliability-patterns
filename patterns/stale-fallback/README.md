# Stale fallback (SLA expiry as a first-class outcome)

Pending work doesn't get to wait forever. After an SLA, it expires, an incident opens, and the system stops pretending nothing happened.

## The problem

Anything that needs a human (or another agent) before it can proceed has a hidden third state, beyond "approved" and "rejected": **abandoned**. The approval that sat overnight, the question that nobody answered, the second-factor request that timed out. By the time someone sees it, the underlying decision has often gone stale - but the queue still says "pending" and the requester is still blocked.

The naïve fix - a TTL - undercounts the problem. A silently dropped item is information, not noise. You want to:

1. Move the item out of `pending` so downstream consumers stop waiting.
2. Record *why* it expired (SLA, not approval).
3. Open an incident, because a human-in-the-loop step that didn't get a human is itself a failure to handle.

## What this pattern does

- A small periodic job (call it from cron, the coordinator loop, or a scheduled function) sweeps for `pending` items past their `expiresAt`.
- Each one is transitioned to `expired` and emits two events: `<item>_resolved` (decision = `expired`) and `incident_opened` (so it shows up in your ops view, not just buried in a status column).
- Idempotent - running it twice does nothing the second time.

## When to use it

- Approval queues, agent-to-agent handoffs, second-factor confirmations, manual-review steps.
- Any state machine where `pending` could otherwise be a permanent resting place.

## When not to use it

- Long-lived async work that legitimately takes hours/days (e.g., human review of a complex case) - pick the SLA carefully or you'll just create alert fatigue.
- Items with no meaningful "too late" - if expiring is indistinguishable from approving, don't expire.

## Reference

- [`stale-fallback.ts`](./stale-fallback.ts) - sweep-and-expire job, dual-event emission, idempotent.

## Lineage

The sweep-and-expire job ran in Mission Control v1 against its approval queue. v2 takes a stricter stance for its main pending queue: an agent's tool-call request cannot go stale, because [it is denied the moment the session that created it disconnects](https://github.com/leveretlogic/agent-mission-control#approving-an-ai-agents-tool-calls-from-a-phone) - deny-on-disconnect removes the "abandoned pending item" state instead of sweeping it. That works when pending items are tied to a live session; use this pattern's SLA sweep when they must survive one (queues backed by a database, cross-agent handoffs, anything a restart shouldn't silently drop).
