// Health watchdog with consecutive-failure threshold, dedup, and side-channel
// escalation. Designed to be called once per coordinator/cron cycle. Pure
// functions; persist `WatchdogState` between calls (file, DB row, KV).

export interface WatchdogState {
  consecutiveFailures: number;
  incidentOpenFor: string | null; // dedup key; null when healthy
  lastSideChannelAlertAt: string | null;
}

export interface WatchdogConfig {
  name: string; // e.g. "gateway"
  incidentThreshold: number; // emit incident at this many consecutive failures (default 3)
  sideChannelThreshold: number; // send out-of-band alert at this many (default 3)
  alertCooldownMs: number; // min gap between side-channel alerts (default 1h)
}

export interface WatchdogIO {
  probe: () => Promise<boolean>; // true = healthy
  emitEvent: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
  sendSideChannelAlert: (message: string) => Promise<void>; // MUST NOT depend on the probed system
}

export function newWatchdogState(): WatchdogState {
  return { consecutiveFailures: 0, incidentOpenFor: null, lastSideChannelAlertAt: null };
}

export async function runWatchdogCycle(
  state: WatchdogState,
  config: WatchdogConfig,
  io: WatchdogIO,
  now: Date = new Date(),
): Promise<{ healthy: boolean; state: WatchdogState }> {
  const ok = await io.probe().catch(() => false);

  if (ok) {
    if (state.incidentOpenFor) {
      await io.emitEvent({
        type: "incident_resolved",
        payload: { component: config.name, recoveredAfter: state.consecutiveFailures },
      });
    }
    return {
      healthy: true,
      state: { consecutiveFailures: 0, incidentOpenFor: null, lastSideChannelAlertAt: state.lastSideChannelAlertAt },
    };
  }

  const consecutive = state.consecutiveFailures + 1;
  const next: WatchdogState = { ...state, consecutiveFailures: consecutive };

  // Open an incident the first time we cross the threshold, dedup until recovery.
  if (consecutive >= config.incidentThreshold && state.incidentOpenFor !== config.name) {
    await io.emitEvent({
      type: "incident_opened",
      payload: { component: config.name, consecutiveFailures: consecutive, reason: `${config.name}_unreachable` },
    });
    next.incidentOpenFor = config.name;
  }

  // Side-channel escalation — bypasses the failing dependency, rate-limited.
  if (consecutive >= config.sideChannelThreshold) {
    const lastMs = state.lastSideChannelAlertAt ? new Date(state.lastSideChannelAlertAt).getTime() : 0;
    if (now.getTime() - lastMs >= config.alertCooldownMs) {
      await io.sendSideChannelAlert(
        `[${config.name}] unreachable for ${consecutive} consecutive checks. Investigate immediately.`,
      );
      next.lastSideChannelAlertAt = now.toISOString();
    }
  }

  return { healthy: false, state: next };
}
