#!/bin/zsh
# Starts everything RddtFun needs locally and opens the app in the default browser:
#   - local server on :3910: Whisper word timings for Fish voices (Pocket TTS off; POCKET_WORKERS=4 turns it on)
#   - Vite frontend on :5173 + backend on :3000
# Fish Drama 3 runs on Modal (backend/cloud-tts) and boots itself when a job needs it.
# Used by the optional "RddtFun" macOS app (scripts/RddtFun.applescript); also runnable directly.

REPO="${0:A:h:h}"  # repo root = parent of this script's folder (zsh)
URL="http://localhost:5173"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$REPO" || exit 1

# Local TTS / Whisper server in the background; stopped with the rest when this window closes.
TTS_PID=""
if ! lsof -nP -iTCP:3910 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting Whisper server on :3910..."
  (cd backend/local-tts && POCKET_WORKERS=${POCKET_WORKERS:-0} ./start.sh) 2>&1 | sed -u 's/^/[tts] /' &
  TTS_PID=$!
fi
# Closing the window must stop everything this script started: concurrently/nodemon ignore SIGHUP,
# so kill the whole process tree (deepest first) rather than relying on the signal reaching them.
descendants() {
  local child
  for child in $(pgrep -P "$1"); do
    descendants "$child"
    echo "$child"
  done
}
cleanup() {
  trap - EXIT INT TERM HUP
  local pids=($(descendants $$)) root
  # On window close npm dies first and its children are re-parented, so also find them by path
  for root in $(pgrep -f "$REPO/node_modules/.bin/(concurrently|nodemon)"); do
    pids+=($(descendants "$root") "$root")
  done
  [ ${#pids} -gt 0 ] && kill $pids 2>/dev/null
}
trap cleanup EXIT INT TERM HUP

# Open the browser once all servers are listening.
(
  for i in {1..120}; do
    if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1 && lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 \
      && lsof -nP -iTCP:3910 -sTCP:LISTEN >/dev/null 2>&1; then
      open "$URL"
      exit 0
    fi
    sleep 1
  done
  echo "Servers did not come up within 120s; check the output above."
) &

echo "Starting RddtFun (close this window or press Ctrl+C to stop)..."
# In the background + wait, so a close/Ctrl+C runs cleanup at once, while the process tree is intact
PORT=3000 npm run dev:all &
wait $!
