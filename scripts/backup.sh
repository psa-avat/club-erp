#!/usr/bin/env bash
# Extracts the SQL DDL schema (CREATE TABLE statements) from erp_club_db
# by running pg_dump inside the erp-db-dev Docker container.

set -euo pipefail

CONTAINER="${CONTAINER:-erp-db-dev}"
DB_USER="${DB_USER:-erpuser}"
DB_NAME="${DB_NAME:-erp_club_db}"
OUTPUT="${1:-data_$(date +%Y%m%d_%H%M%S)}"

echo "Running pg_dump inside container: ${CONTAINER}"
echo "Database: ${DB_USER}@${DB_NAME}"
echo "Output file: ${OUTPUT}"

docker exec "${CONTAINER}" \
  pg_dump -Fc \
    --username="${DB_USER}" \
    --dbname="${DB_NAME}" \
    --no-owner \
    --no-privileges \
  > "${OUTPUT}"

echo "Schema extracted successfully to: ${OUTPUT}"
