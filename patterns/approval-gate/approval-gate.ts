// Approval gate with risk-tiered SLA.
//
// Storage is intentionally abstracted behind a thin `ApprovalStore` interface so
// you can back it with SQLite, Postgres, Redis, or an in-memory map. The same
// goes for `EventEmitter` — wire it to whatever audit pipeline you already have.

export type RiskLevel = "low" | "medium" | "high";

export interface ApprovalRequestInput {
  action: string;
  actor: string;
  riskLevel: RiskLevel;
  target?: string;
  note?: string;
  confirmedTwice?: boolean;
}

export interface ApprovalRecord {
  id: string;
  action: string;
  actor: string;
  riskLevel: RiskLevel;
  target: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string | null;
  createdAt: string;
}

export interface ApprovalStore {
  insert(record: ApprovalRecord): void;
  findById(id: string): ApprovalRecord | undefined;
  updateStatus(id: string, status: ApprovalRecord["status"], decisionNote?: string): void;
  listExpiredPending(now: Date): ApprovalRecord[];
}

export interface EventEmitter {
  emit(event: { type: string; payload: Record<string, unknown> }): void;
}

const APPROVAL_SLA_MINUTES: Record<RiskLevel, number> = {
  high: 90,
  medium: 20,
  low: 0, // no expiry
};

const OPERATIONAL_WINDOW = { startHour: 9, endHour: 19 };

function isWithinOperationalWindow(now: Date, timeZone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone })
      .formatToParts(now)
      .find((p) => p.type === "hour")?.value ?? "0",
  );
  return hour >= OPERATIONAL_WINDOW.startHour && hour < OPERATIONAL_WINDOW.endHour;
}

function requiresDoubleConfirm(riskLevel: RiskLevel, now: Date, timeZone: string): boolean {
  if (riskLevel !== "high") return false;
  return !isWithinOperationalWindow(now, timeZone);
}

function addMinutes(d: Date, m: number): Date {
  const out = new Date(d);
  out.setMinutes(out.getMinutes() + m);
  return out;
}

export function makeApprovalGate(deps: {
  store: ApprovalStore;
  events: EventEmitter;
  timeZone: string;
  newId: () => string;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  function request(input: ApprovalRequestInput) {
    const at = now();

    if (requiresDoubleConfirm(input.riskLevel, at, deps.timeZone) && !input.confirmedTwice) {
      return { blocked: true as const, reason: "high_risk_outside_window_requires_double_confirmation" };
    }

    const sla = APPROVAL_SLA_MINUTES[input.riskLevel];
    const record: ApprovalRecord = {
      id: deps.newId(),
      action: input.action,
      actor: input.actor,
      riskLevel: input.riskLevel,
      target: input.target ?? null,
      status: "pending",
      expiresAt: sla > 0 ? addMinutes(at, sla).toISOString() : null,
      createdAt: at.toISOString(),
    };

    deps.store.insert(record);
    deps.events.emit({
      type: "approval_requested",
      payload: { approvalId: record.id, action: record.action, riskLevel: record.riskLevel, expiresAt: record.expiresAt },
    });

    return { blocked: false as const, id: record.id, expiresAt: record.expiresAt };
  }

  function resolve(input: { approvalId: string; decision: "approved" | "rejected"; actor: string; reason?: string }) {
    const row = deps.store.findById(input.approvalId);
    if (!row) return { ok: false as const, error: "not_found" };
    if (row.status !== "pending") return { ok: false as const, error: "not_pending" };

    deps.store.updateStatus(row.id, input.decision, input.reason);
    deps.events.emit({
      type: "approval_resolved",
      payload: { approvalId: row.id, action: row.action, decision: input.decision, by: input.actor, reason: input.reason ?? null },
    });

    return { ok: true as const, status: input.decision };
  }

  // Run periodically (cron / coordinator loop). Idempotent.
  function expirePending() {
    const expired = deps.store.listExpiredPending(now());
    for (const row of expired) {
      deps.store.updateStatus(row.id, "expired");
      deps.events.emit({
        type: "approval_resolved",
        payload: { approvalId: row.id, action: row.action, decision: "expired", reason: "SLA expired" },
      });
      // Open an incident — an expired approval is a missed decision, not silence.
      deps.events.emit({
        type: "incident_opened",
        payload: { title: "Approval expired", approvalId: row.id, action: row.action, riskLevel: row.riskLevel },
      });
    }
    return { expired: expired.length };
  }

  return { request, resolve, expirePending };
}
