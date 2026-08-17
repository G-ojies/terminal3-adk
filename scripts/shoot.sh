#!/usr/bin/env bash
# Capture a genuine screenshot of a command running in a real terminal.
#
#   scripts/shoot.sh <output.png> <title> <command...>
#
# Launches an xterm (an X11 client, so capturable through XWayland), runs the
# command, waits for it to finish, then grabs that window only — never the root
# window, so nothing else on the desktop is captured.
set -uo pipefail

OUT="$1"; shift
TITLE="$1"; shift
CMD="$*"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DONE="$(mktemp -u /tmp/t3n-shot-XXXXXX.done)"

# Route the command through a file so any quoting survives intact.
CMDFILE="$(mktemp /tmp/t3n-cmd-XXXXXX.sh)"
printf '%s\n' "$CMD" > "$CMDFILE"
RUNNER="$(mktemp /tmp/t3n-run-XXXXXX.sh)"
cat > "$RUNNER" <<RUNEOF
cd '$REPO'
printf '\$ '; cat '$CMDFILE'; echo
bash '$CMDFILE'
echo; echo "[exit \$?]"
touch '$DONE'
RUNEOF

# -hold keeps the window up after the command exits so it can be captured.
xterm -title "$TITLE" \
      -fa "DejaVu Sans Mono" -fs "${FS:-10}" \
      -geometry "${COLS:-205}x${ROWS:-52}" \
      -bg "#0b0e14" -fg "#e6e6e6" \
      -hold \
      -e bash "$RUNNER" &
XPID=$!

# Wait for the command to finish (generous: these hit a live network).
for _ in $(seq 1 240); do
  [ -f "$DONE" ] && break
  sleep 1
done
sleep 2   # let the terminal finish painting

WID=$(xwininfo -name "$TITLE" -int 2>/dev/null | awk '/Window id:/{print $4}')
if [ -z "${WID:-}" ]; then
  echo "FAILED: no window titled '$TITLE'"
  kill $XPID 2>/dev/null
  rm -f "$DONE"
  exit 1
fi

import -window "$WID" "$OUT" 2>/dev/null
RC=$?

# Crop the unused rows below the output, then restore a small even margin.
if [ $RC -eq 0 ] && [ -s "$OUT" ]; then
  convert "$OUT" \
    -bordercolor '#0b0e14' -border 1 -trim +repage \
    -bordercolor '#0b0e14' -border 18 "$OUT" 2>/dev/null || true
fi

kill $XPID 2>/dev/null
rm -f "$DONE" "$CMDFILE" "$RUNNER"

if [ $RC -eq 0 ] && [ -s "$OUT" ]; then
  echo "OK  $OUT  ($(identify -format '%wx%h' "$OUT" 2>/dev/null))"
else
  echo "FAILED to capture $OUT"
  exit 1
fi
