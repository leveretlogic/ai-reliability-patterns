# AI Reliability Patterns

Small, copy-pasteable patterns for keeping AI agent systems honest in production: approval gates, health watchdogs, freshness checks, and stale-action fallbacks. Extracted from a real multi-agent ops dashboard, [Agent Mission Control](https://github.com/leveretlogic/agent-mission-control).

**Status:** Active · **Stack:** TypeScript (framework-agnostic) · **License:** MIT

## Why these patterns exist

Most agent failures in production aren't model failures — they're operational. A green status with the wrong outcome. A coordinator loop that hasn't fired in 4 hours and nobody noticed. A high-risk approval that sat pending overnight. A gateway that's been dead for 30 minutes while the dashboard happily reports "all OK" because nothing is checking the checker.

These patterns are the load-bearing pieces I keep reaching for when I want an agent system to fail loudly instead of silently. Each one is small (≤120 lines), framework-agnostic, and battle-tested in [Agent Mission Control](https://github.com/leveretlogic/agent-mission-control), where they sit under 5 agents running across Telegram and Discord.

They are not a framework. Copy the file, adapt the storage layer (the snippets use a thin SQLite/Prisma-shaped interface but you can swap in Postgres, Redis, or anything else), and own the code.

## The four patterns

| Pattern | Problem it solves | When to reach for it |
|---|---|---|
| [Approval gate](./patterns/approval-gate) | Risky agent actions need a human in the loop, but humans are slow and unreliable too. | Any action where "wrong" is much more expensive than "delayed". |
| [Health watchdog](./patterns/health-watchdog) | Your monitoring depends on the thing being monitored. When the gateway dies, the alert pipeline often dies with it. | Whenever a critical dependency could itself break the alarm path. |
| [Heartbeat freshness](./patterns/heartbeat-freshness) | A scheduler that's stopped firing looks identical to one that has nothing to do. Silence is ambiguous. | Cron jobs, polling loops, agent turn schedulers — anything periodic. |
| [Stale fallback](./patterns/stale-fallback) | Pending work waits forever. An approval that sat overnight is no longer the same decision. | Any human-in-the-loop step with a meaningful "too late" boundary. |

## How to use this repo

Each pattern is self-contained in `patterns/<name>/` with:

- A short README — problem, when to use, when not to use
- A reference implementation in TypeScript (`<name>.ts`)
- Inline comments only where the *why* is non-obvious

Read the pattern README first. The code is meant to be obvious; the README explains the trade-offs that the code can't.

## Related

- [Agent Mission Control](https://github.com/leveretlogic/agent-mission-control) — the project these patterns came from. See it in context.
- Posts: [`leveretlogic`](https://www.linkedin.com/in/leveretlogic) on LinkedIn writes about reliable agent systems.

## License

MIT — see [LICENSE](LICENSE).
