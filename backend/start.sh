#!/bin/bash

# 3. Load Environment Variables safely
if [ -f ../deploy/.env ]; then
    # 'set -a' automatically exports all variables defined in .env
    set -a
    source ../deploy/.env
    set +a
    echo "Environment variables loaded."
else
    echo "Warning: .env file not found!"
fi

# 4. Kill previous instance? (Optional)
# Uncomment the next line if you want to restart cleanly every time
pkill -f "uvicorn main:app" || echo "No previous instance found, starting fresh."

# 5. Launch the App in Background
# We use 'nohup' so it keeps running if you disconnect SSH
# We redirect logs to 'backend.log'
./venv/bin/uvicorn main:app --reload --host 0.0.0.0 --proxy-headers --forwarded-allow-ips=* &

# 6. Print the Process ID (PID) so you know it started
echo "Backend started with PID $!"
