# Approval gate (with risk-tiered SLA)

A human-in-the-loop gate for risky agent actions. Each request gets a risk level (`low` | `medium` | `high`); the SLA, the expiration behaviour, and whether double-confirmation is required all flow from that one field.

## The problem

Telling an agent "ask me before doing anything irreversible" sounds simple, but production systems ruin it in one of three ways:

1. **No SLA.** The approval sits pending forever; by the time someone notices, the underlying action is no longer the right call.
2. **Same friction for every action.** Either everything blocks (operators ignore the queue) or nothing blocks (the gate is theatre).
3. **No audit trail.** When something does go wrong, you can't reconstruct who approved what, when, or under what risk classification.

## What this pattern does

- Classifies every action by risk level — and ties risk to SLA: `high` = 90 min, `medium` = 20 min, `low` = no expiry.
- Requires double-confirmation for `high` risk **outside the operational window** (a deliberately higher bar when an operator is more likely to be tired or distracted).
- Emits a structured event on every state change (`approval_requested`, `approval_resolved`, expiration → `incident_opened`) so the audit trail is automatic, not retrofitted.
- Separates "request the approval" from "expire stale approvals" — the latter is a periodic job, not a side effect of reads.

## When to use it

- Any action where "wrong" is much more expensive than "delayed": deletes, payments, outbound messages, irreversible state changes.
- Multi-agent setups where you want a single human-facing queue rather than each agent inventing its own approval UX.

## When not to use it

- Read-only or trivially reversible actions — the gate becomes noise.
- Sub-second latency requirements — this assumes minutes, not milliseconds.

## Reference

- [`approval-gate.ts`](./approval-gate.ts) — request, resolve, expire-pending; risk-level policy; event emission.
- See it in production: [Mission Control · `lib/approvals/service.ts`](https://github.com/leveretlogic/agent-mission-control/blob/main/lib/approvals/service.ts).
