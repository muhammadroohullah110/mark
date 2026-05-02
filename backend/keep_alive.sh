#!/bin/bash
# ============================================================
# Mark AI — Keep Alive (add to cPanel Cron Job)
# Checks if Mark backend is running, restarts if dead
# ============================================================

cd "$(dirname "$0")"

if ! pgrep -f "uvicorn main:app.*8090" > /dev/null; then
    source venv/bin/activate
    nohup python -m uvicorn main:app --host 127.0.0.1 --port 8090 --workers 1 >> mark.log 2>&1 &
    echo "$(date): Mark restarted" >> mark.log
fi
