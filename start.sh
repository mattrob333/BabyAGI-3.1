#!/bin/bash
set -e

echo "Starting BabyAGI3..."

# Use /data as HOME so ~/.babyagi maps to the persistent volume at /data/.babyagi
export HOME=/data

# Ensure the babyagi data dir exists
mkdir -p /data/.babyagi

# Write init marker so the setup wizard doesn't block startup
if [ ! -f /data/.babyagi/initialized ]; then
    echo '{"initialized_at":"2026-01-01T00:00:00","owner":"deploy","version":"0.3.0"}' > /data/.babyagi/initialized
fi

# Start the Python backend with all channels
# - Use --group telegram to include python-telegram-bot
# - Pipe /dev/null to stdin so CLI listener exits cleanly without blocking
cd /app/babyagi3
uv run --group telegram python main.py all < /dev/null &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
for i in $(seq 1 60); do
    if curl -s http://localhost:${BABYAGI_PORT:-5000}/health > /dev/null 2>&1; then
        echo "Backend ready!"
        break
    fi
    sleep 1
done

# Start the Next.js frontend
cd /app/web-standalone
HOSTNAME=0.0.0.0 node server.js &
FRONTEND_PID=$!

echo "BabyAGI3 is running!"
echo "  Backend:  http://0.0.0.0:${BABYAGI_PORT:-5000}"
echo "  Frontend: http://0.0.0.0:${PORT:-3000}"

# Wait for either process to exit
wait -n $BACKEND_PID $FRONTEND_PID

# If one exits, kill the other
kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
wait
