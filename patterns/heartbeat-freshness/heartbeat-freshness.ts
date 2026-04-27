// Heartbeat freshness check.
//
// Detects "the scheduler stopped firing and nobody noticed" by comparing the
// freshest job's last-run timestamp against a business-hour expectation window.

export interface ScheduledJob {
  id: string;
  name: string;
  enabled: boolean;
  lastRunAtMs: number; // 0 = never run
}

export interface FreshnessConfig {
  timeZone: string; // e.g. "Europe/Lisbon"
  businessHours: { startHour: number; endHour: number }; // [start, end)
  incidentAfterHours: number; // open incident when stale >= this (default 2)
  alertAfterHours: number; // side-channel alert when stale >= this (default 3)
}

export interface FreshnessIO {
  emitEvent: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
  sendSideChannelAlert: (message: string) => Promise<void>;
}

export interface FreshnessState {
  incidentOpen: boolean;
  lastAlertAt: string | null;
}

function hourInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export function newFreshnessState(): FreshnessState {
  return { incidentOpen: false, lastAlertAt: null };
}

export async function checkFreshness(
  jobs: ScheduledJob[],
  state: FreshnessState,
  config: FreshnessConfig,
  io: FreshnessIO,
  now: Date = new Date(),
): Promise<{ fresh: boolean; ageHours: number; state: FreshnessState }> {
  const enabled = jobs.filter((j) => j.enabled);
  if (enabled.length === 0) return { fresh: true, ageHours: 0, state };

  const latest = enabled.reduce((acc, j) => (j.lastRunAtMs > acc.lastRunAtMs ? j : acc), enabled[0]);
  const ageHours = (now.getTime() - latest.lastRunAtMs) / (60 * 60_000);

  const hour = hourInTimeZone(now, config.timeZone);
  const inBusinessHours = hour >= config.businessHours.startHour && hour < config.businessHours.endHour;

  // Off-hours silence is not a failure mode — only escalate inside the window.
  if (!inBusinessHours || ageHours < config.incidentAfterHours) {
    if (state.incidentOpen && ageHours < config.incidentAfterHours) {
      await io.emitEvent({ type: "incident_resolved", payload: { component: "scheduler", recoveredAfterHours: Number(ageHours.toFixed(1)) } });
      return { fresh: true, ageHours, state: { ...state, incidentOpen: false } };
    }
    return { fresh: true, ageHours, state };
  }

  const next: FreshnessState = { ...state };

  if (!state.incidentOpen) {
    await io.emitEvent({
      type: "incident_opened",
      payload: {
        component: "scheduler",
        reason: "scheduled_jobs_stale",
        lastJobName: latest.name,
        lastRunAt: latest.lastRunAtMs ? new Date(latest.lastRunAtMs).toISOString() : "never",
        ageHours: Number(ageHours.toFixed(1)),
      },
    });
    next.incidentOpen = true;
  }

  if (ageHours >= config.alertAfterHours) {
    const lastMs = state.lastAlertAt ? new Date(state.lastAlertAt).getTime() : 0;
    if (now.getTime() - lastMs >= 60 * 60_000) {
      await io.sendSideChannelAlert(
        `Scheduler stale: no job has run in ${ageHours.toFixed(1)}h (last: "${latest.name}"). Scheduler may be down.`,
      );
      next.lastAlertAt = now.toISOString();
    }
  }

  return { fresh: false, ageHours, state: next };
}
