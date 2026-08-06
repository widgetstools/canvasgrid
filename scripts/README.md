# Scripts

## Cross-platform demo helpers

| Script | Purpose |
|--------|---------|
| `node scripts/run-stomp.mjs` | Start sibling starui STOMP server (macOS/Windows/Linux) |
| `node scripts/run-ext-openfin.mjs` | Vite + STOMP + OpenFin without shell `&&` |
| `node scripts/verify-demos.mjs` | Boot each demo briefly and check HTTP |

Also exposed as `npm run dev:stomp`, `npm run ext-demo:openfin`, `npm run verify:demos`.

## `run-cycle-tasks.sh` — autonomous cycle runner

Spawns one Claude Code headless session per task in a cycle worklog and
runs them sequentially. Each session is **fresh** (no shared
conversation context) and reads the worklog's per-task instructions
itself. The runner just sequences the sessions and verifies a commit
landed between each.

> macOS/Linux only (bash). Not required to run product demos.

### Quickstart

```bash
# Run a full cycle from Task 1
./scripts/run-cycle-tasks.sh docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md

# Resume at a specific task (e.g. Task 3)
./scripts/run-cycle-tasks.sh docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md 3

# Override the per-task timeout (default 30 min)
TASK_TIMEOUT_SEC=2700 ./scripts/run-cycle-tasks.sh <worklog>

# Use a different model (default: opus)
RUNNER_MODEL=sonnet ./scripts/run-cycle-tasks.sh <worklog>
```

### How it works

- The worklog contains one `## Task N — <description>` block per task,
  with explicit Steps, Acceptance criteria, a Commit message, and a
  "Next session prompt" at the end of each.
- For each task `N` from `start..total`:
  1. Note the current HEAD.
  2. Spawn `claude -p "<short prompt pointing at worklog + Task N>"`
     with `--permission-mode acceptEdits`.
  3. Stream output to `.runner-logs/cycle-<N>-task-<M>-<ts>.log`.
  4. After the session exits, verify a new commit landed on HEAD
     (or that `origin/main` advanced).
  5. If yes, advance. If no, STOP and exit non-zero.
- Stop the loop at any time: `Ctrl-C` (each task is isolated; the
  next task hasn't started).

### Required setup

- `claude` CLI on `PATH` (`brew install` / `npm i -g @anthropic-ai/claude-code`)
- Anthropic credentials configured (`claude` runs `/login` once
  interactively; subsequent headless sessions reuse the keychain).
- `gh` CLI authenticated (`gh auth status`) — sessions open PRs via
  `gh pr create`.
- Repo is clean (no uncommitted changes) before the first task.

### Safety

- Sessions run with `--permission-mode bypassPermissions` — every file
  edit AND every shell command auto-approve with no prompts. The
  spawned session has no human to answer; `acceptEdits` (an earlier
  attempt) stalled on every `git push` / `gh pr create`. The
  trade-off: a hallucinated destructive command runs without a
  guardrail. **Use against trusted repos only; never run on a
  working tree with uncommitted work or a branch that diverges from
  `main`.**
- The runner verifies a commit lands between each task. A session
  that crashes mid-task or hangs past the timeout (`TASK_TIMEOUT_SEC`)
  exits the loop, leaving the partial work in place for human review.
- Each session is fresh: no context leaks from one task to the next.
  The worklog is the contract.

### What if a task fails?

1. The runner exits non-zero. The failing task's log is in
   `.runner-logs/`.
2. Fix the issue manually (revert, edit, push).
3. Resume with `./scripts/run-cycle-tasks.sh <worklog> <next-task-N>`.

### Caveats

- The runner assumes each task opens its own PR to `main`. If a PR
  doesn't merge before the next task starts, the next session may
  branch off a stale main and conflict. Either merge each PR
  immediately (auto-merge label / GitHub's "Merge when ready") or
  use the cascade-merge ritual from previous cycles.
- Headless `claude` can't drive an interactive `gh` flow that
  prompts for confirmation. Run `gh auth setup-git` once before
  starting so the CLI is fully non-interactive.
