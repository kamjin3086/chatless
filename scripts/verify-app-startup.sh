#!/usr/bin/env bash
# Start-up acceptance check for the built app.
#
# Exists because 0.7.0 shipped a window-event handler that called back into
# Tauri's event loop: the app still started, still logged its usual lines, and
# still moved when dragged - but it pinned a core and never finished
# initialising, so the window could not be closed, resized or clicked. A check
# that only looks for "the process is alive" and "ORT loaded" passes on that.
# This one also asserts that initialisation *finishes* and that the app stays
# responsive to a window resize.
#
# Usage: scripts/verify-app-startup.sh [path/to/chatless]

set -uo pipefail

BIN="${1:-src-tauri/target/release/chatless}"
LOG="$HOME/Library/Logs/com.kamjin.chatless/logs.log"
CPU_BUDGET="${CPU_BUDGET:-25}"        # percent of one core, averaged over the sample
PROC_NAME="$(basename "$BIN")"

pass=0
fail=0
skip=0
check() { # check <description> <0|1 ok>
  if [ "$2" = "0" ]; then
    printf '  \033[32mPASS\033[0m %s\n' "$1"
    pass=$((pass + 1))
  elif [ "$2" = "2" ]; then
    printf '  \033[33mSKIP\033[0m %s\n' "$1"
    skip=$((skip + 1))
  else
    printf '  \033[31mFAIL\033[0m %s\n' "$1"
    fail=$((fail + 1))
  fi
}

cpu_percent() { # average CPU of $1 over $2 seconds, in percent of one core
  local pid="$1" secs="$2" t0 t1
  t0=$(ps -o time= -p "$pid" | tr -d ' ')
  sleep "$secs"
  t1=$(ps -o time= -p "$pid" | tr -d ' ')
  python3 - "$t0" "$t1" "$secs" <<'PY'
import sys

def secs(t):
    parts = [float(x) for x in t.split(':')]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]

t0, t1, span = secs(sys.argv[1]), secs(sys.argv[2]), float(sys.argv[3])
print(f"{max(0.0, (t1 - t0) / span * 100):.1f}")
PY
}

ax() { osascript -e "tell application \"System Events\" to tell process \"$PROC_NAME\" to $1" 2>&1; }

# Accessibility (used to resize the window) is granted per controlling app and
# can be unavailable in a given terminal session; those checks then skip rather
# than report a false failure. If even Finder reports no windows, AX is off.
ax_usable() {
  local n
  n=$(osascript -e 'tell application "System Events" to tell process "Finder" to count of windows' 2>/dev/null)
  case "$n" in ''|*[!0-9]*) return 1 ;; 0) return 1 ;; *) return 0 ;; esac
}

echo "== app start-up check =="
[ -x "$BIN" ] || { echo "no binary at $BIN (run: cargo build --release)"; exit 1; }

pkill -f "$BIN" 2>/dev/null && { echo "stopped a running instance"; sleep 3; }

before=$(wc -l <"$LOG" 2>/dev/null | tr -d " " || echo 0)
"$BIN" >/tmp/verify-app-startup.out 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null' EXIT

AX_OK=0
ax_usable || AX_OK=1

# 1. it starts and gets a window
if [ "$AX_OK" = "1" ]; then
  check "the app opens a window" 2
else
  window=1
  for _ in $(seq 1 30); do
    sleep 2
    if ax 'count of windows' | grep -qE '^[1-9]'; then window=0; break; fi
  done
  check "the app opens a window" $window
fi

# 2. initialisation finishes (the frontend's model service, then MCP servers)
init=1
for _ in $(seq 1 20); do
  if tail -n +"$before" "$LOG" | grep -q 'MCP/stdio.*First connection attempt successful'; then init=0; break; fi
  sleep 3
done
if [ "$init" != "0" ]; then
  # no servers may be configured at all; then the environment setup line is the signal
  tail -n +"$before" "$LOG" | grep -q 'Environment setup completed' && init=0
fi
check "start-up finishes (model service + MCP)" $init

# 3. idle CPU
idle_cpu=$(cpu_percent "$pid" 5)
awk -v c="$idle_cpu" -v b="$CPU_BUDGET" 'BEGIN{exit !(c < b)}'
check "idle CPU below ${CPU_BUDGET}% (measured ${idle_cpu}%)" $?

# 4. it answers a window resize - the case that used to pin a core
if [ "$AX_OK" = "1" ]; then
  check "the window resizes" 2
  check "still responsive after the resize" 2
else
size_before=$(ax 'size of window 1' | tr -d ' ')
ax 'set size of window 1 to {1000, 720}' >/dev/null
sleep 2
size_after=$(ax 'size of window 1' | tr -d ' ')
[ "$size_before" != "$size_after" ] && [ -n "$size_after" ]
check "the window resizes (${size_before} -> ${size_after})" $?

ax 'set size of window 1 to {1280, 800}' >/dev/null
sleep 2

# 5. still responsive and quiet after the resize
ax 'count of windows' | grep -qE '^[1-9]'
check "still responsive after the resize" $?
fi
resized_cpu=$(cpu_percent "$pid" 5)
awk -v c="$resized_cpu" -v b="$CPU_BUDGET" 'BEGIN{exit !(c < b)}'
check "CPU still below ${CPU_BUDGET}% after the resize (measured ${resized_cpu}%)" $?

# 6. no panic on the way
grep -qiE 'panic|thread .* panicked' /tmp/verify-app-startup.out
[ $? -ne 0 ]
check "no panic in the process output" $?

kill "$pid" 2>/dev/null
sleep 2

echo
echo "passed: $pass   failed: $fail   skipped: $skip"
[ "$fail" = "0" ]
