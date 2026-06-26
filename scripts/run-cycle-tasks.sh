#!/usr/bin/env bash
# scripts/run-cycle-tasks.sh
#
# Spawn one Claude Code headless session per task in a cycle worklog,
# running them sequentially. Each session is fresh (no shared context)
# and reads the worklog's per-task "Next session prompt" block to know
# what to do. The script polls git after each session to confirm a new
# commit landed before advancing.
#
# Usage:
#   scripts/run-cycle-tasks.sh <worklog-path> [<starting-task-N>]
#
# Examples:
#   scripts/run-cycle-tasks.sh docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md
#   scripts/run-cycle-tasks.sh docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md 3   # resume at Task 3
#
# Per-task flow:
#   1. Detect HEAD commit before the session
#   2. Spawn `claude -p` with the task's prompt + permission-mode=acceptEdits
#   3. Wait for the session to exit (success = commit landed on the current branch
#      OR a new branch was pushed)
#   4. If a commit landed, advance to the next task; otherwise STOP
#
# Logs land in `.runner-logs/cycle-<N>-task-<M>-<timestamp>.log`.
#
# Safety:
#   - Uses --permission-mode acceptEdits (NOT bypass) so file edits + standard
#     commands run without prompts but truly dangerous operations still gate.
#   - Wraps each session with a per-task timeout (default 30 min, overridable
#     via TASK_TIMEOUT_SEC env var).
#   - Stops the loop on the first failure so a broken task doesn't cascade.
#
# Stop the loop at any time: Ctrl-C (no cleanup needed; each task is its own
# isolated session).

set -euo pipefail

WORKLOG="${1:-}"
START_TASK="${2:-1}"
TASK_TIMEOUT_SEC="${TASK_TIMEOUT_SEC:-1800}"  # 30 min default per task
MODEL="${RUNNER_MODEL:-opus}"

if [[ -z "$WORKLOG" || ! -f "$WORKLOG" ]]; then
  echo "Usage: $0 <worklog-path> [<starting-task-N>]" >&2
  echo "Example: $0 docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR=".runner-logs"
mkdir -p "$LOG_DIR"

# Extract the cycle number from the worklog path (e.g. cycle-08 → 8).
CYCLE_N="$(basename "$WORKLOG" | sed -nE 's/.*cycle-0?([0-9]+).*/\1/p')"
CYCLE_N="${CYCLE_N:-X}"

# Count total tasks via "^## Task N —" headings.
TOTAL_TASKS="$(grep -cE '^## Task [0-9]+' "$WORKLOG")"

if [[ "$TOTAL_TASKS" -lt 1 ]]; then
  echo "[runner] no Task headings found in $WORKLOG" >&2
  exit 1
fi

echo "[runner] cycle $CYCLE_N — $TOTAL_TASKS tasks — starting at Task $START_TASK"
echo "[runner] worklog:     $WORKLOG"
echo "[runner] log dir:     $LOG_DIR"
echo "[runner] timeout/task: ${TASK_TIMEOUT_SEC}s"
echo "[runner] model:       $MODEL"
echo ""

for (( TASK_N=START_TASK; TASK_N<=TOTAL_TASKS; TASK_N++ )); do
  TS="$(date +%Y%m%d-%H%M%S)"
  TASK_LOG="$LOG_DIR/cycle-${CYCLE_N}-task-${TASK_N}-${TS}.log"

  echo "========================================================================"
  echo "[runner] Task $TASK_N / $TOTAL_TASKS — log: $TASK_LOG"
  echo "========================================================================"

  # The session prompt is intentionally tiny — the agent reads the worklog
  # itself for the full instructions. This keeps the runner agnostic to
  # the cycle's contents.
  PROMPT="Read $WORKLOG and execute Task $TASK_N exactly as written. \
Follow the Global Constraints at the top of the worklog. After the task \
lands its commit, open a PR to main via gh, wait for CI / merge if you can, \
then STOP — do NOT proceed to Task $((TASK_N + 1)). The next task will run \
in a fresh session."

  HEAD_BEFORE="$(git rev-parse HEAD)"

  # Run the session. `acceptEdits` permission mode means Edit/Write/Bash all
  # auto-approve; truly dangerous operations still gate.
  # Use `gtimeout` (brew install coreutils) or `timeout` if available;
  # fall back to no wall-clock cap on macOS without coreutils (claude's
  # own heartbeat still gates runaway sessions).
  if command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_CMD=(gtimeout "$TASK_TIMEOUT_SEC")
  elif command -v timeout >/dev/null 2>&1; then
    TIMEOUT_CMD=(timeout "$TASK_TIMEOUT_SEC")
  else
    TIMEOUT_CMD=()
    if [[ "$TASK_N" == "$START_TASK" ]]; then
      echo "[runner] note: no timeout(1) on PATH — claude sessions run uncapped." >&2
      echo "[runner] note: install coreutils for wall-clock caps:  brew install coreutils" >&2
    fi
  fi

  # `${arr[@]+...}` form is the safe expansion under `set -u` when the
  # array might be empty (no timeout command on PATH).
  if ! ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} claude -p "$PROMPT" \
      --permission-mode acceptEdits \
      --model "$MODEL" \
      --output-format text \
      2>&1 | tee "$TASK_LOG"; then
    EXIT_CODE=$?
    echo ""
    echo "[runner] Task $TASK_N FAILED (claude exit $EXIT_CODE)" >&2
    echo "[runner] log: $TASK_LOG" >&2
    exit "$EXIT_CODE"
  fi

  HEAD_AFTER="$(git rev-parse HEAD)"

  if [[ "$HEAD_BEFORE" == "$HEAD_AFTER" ]]; then
    # No new commit on the current branch — the session may have pushed a
    # branch + opened a PR without merging. Verify by checking origin.
    git fetch origin main 2>&1 | tail -1
    ORIGIN_MAIN="$(git rev-parse origin/main)"
    if [[ "$HEAD_BEFORE" == "$ORIGIN_MAIN" ]]; then
      echo "" >&2
      echo "[runner] Task $TASK_N — no new commits on HEAD or origin/main." >&2
      echo "[runner] The session may have opened a PR that's awaiting merge." >&2
      echo "[runner] Merge the PR + sync main, then re-run with START_TASK=$((TASK_N + 1))." >&2
      exit 1
    fi
    # origin/main moved → pull and continue.
    git pull --ff-only origin main 2>&1 | tail -2
  fi

  echo ""
  echo "[runner] Task $TASK_N landed. New HEAD: $(git rev-parse --short HEAD)"
  echo ""
done

echo "========================================================================"
echo "[runner] Cycle $CYCLE_N complete — all $TOTAL_TASKS tasks landed."
echo "========================================================================"
