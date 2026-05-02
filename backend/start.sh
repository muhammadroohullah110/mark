#!/bin/bash
# ============================================================
# Mark AI Backend — Starter Script for cPanel
# This runs uvicorn on a non-standard port (8090)
# ============================================================

cd "$(dirname "$0")"

# Activate virtual environment
source venv/bin/activate

# Kill any existing Mark process
pkill -f "uvicorn main:app.*8090" 2>/dev/null

# Start Mark backend (nohup = keeps running after terminal closes)
nohup python -m uvicorn main:app --host 127.0.0.1 --port 8090 --workers 1 > mark.log 2>&1 &

echo "Mark backend started on port 8090 (PID: $!)"
echo "Log: mark.log"
