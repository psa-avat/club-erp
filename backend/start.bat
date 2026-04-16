SET LOGURU_DIR=./logs
SET CONF_EMAIL_FILE=./conf_emails.json
SET DB_ENGINE=sqlite
SET ENVIRONMENT=DEV

venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --reload