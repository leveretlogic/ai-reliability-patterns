// Stale-fallback sweep.
//
// Run periodically (e.g. every coordinator cycle, or on a 1-minute cron). Moves
// pending items past their SLA into `expired` and emits both a decision event
// and an incident — so the ops pane sees the missed decision, not silence.

export interface PendingItem {
  id: string;
  kind: string; // e.g. "approval", "second_factor", "agent_handoff"
  riskLevel?: "low" | "medium" | "high";
  expiresAt: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

export interface StaleStore {
  listExpiredPending: (now: Date) => PendingItem[];
  markExpired: (id: string, at: Date) => void; // must be idempotent
}

export interface StaleEvents {
  emit: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
}

export async function expireStalePending(
  store: StaleStore,
  events: StaleEvents,
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const stale = store.listExpiredPending(now);

  for (const item of stale) {
    store.markExpired(item.id, now);

    await events.emit({
      type: `${item.kind}_resolved`,
      payload: {
        id: item.id,
        decision: "expired",
        reason: "SLA expired",
        expiresAt: item.expiresAt,
        ...item.metadata,
      },
    });

    // Pair every expiry with an incident: a missed decision is a failure mode,
    // not a quiet status change. This is what makes it visible in ops dashboards.
    await events.emit({
      type: "incident_opened",
      payload: {
        title: `${item.kind} expired`,
        id: item.id,
        riskLevel: item.riskLevel ?? "low",
        note: `${item.kind} expired without resolution`,
        ...item.metadata,
      },
    });
  }

  return { expired: stale.length };
}
