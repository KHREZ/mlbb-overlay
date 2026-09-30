#!/bin/bash

echo "===================================================="
echo "  Starting MLBB Tournament Broadcast System + scrcpy"
echo "===================================================="

# Start Node.js server in the background
echo "[1/3] Starting Node.js overlay server..."
( node server.js > server.log 2>&1 ) &
SERVER_PID=$!
sleep 2

# Start scrcpy (borderless, 60fps, keeps phone interactive unless disabled)
echo "[2/3] Launching scrcpy phone mirror (borderless, 60fps)..."
scrcpy --window-borderless --max-fps 60 &
SCRCPY_PID=$!

echo "[3/3] All systems online!"
echo ""
echo "  Admin dashboard:  http://localhost:3000/admin.html"
echo "  OBS scoreboard:   http://localhost:3000/overlay.html"
echo "  Logs:             server.log"
echo ""
echo "  Press Ctrl+C to stop everything."
echo "===================================================="

trap "kill $SERVER_PID $SCRCPY_PID 2>/dev/null; exit" INT TERM

wait