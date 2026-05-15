"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - storage: S3-compatible object storage service (aioboto3)
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 """

import logging
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit, urlunsplit
from typing import Any, AsyncGenerator, BinaryIO

import aioboto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.ext.asyncio import AsyncSession

from schemas.storage import STORAGE_SETTINGS_MODULE, StorageSettingsPayload
from services.accounting import get_system_setting

logger = logging.getLogger(__name__)

_SENTINEL = "***"


def _parse_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("1", "true", "yes", "on"):
            return True
        if normalized in ("0", "false", "no", "off"):
            return False
    if value is None:
        return default
    return bool(value)


def _normalize_endpoint(value: Any) -> str:
    if not isinstance(value, str):
        return ""

    candidate = value.strip()
    if not candidate:
        return ""

    parts = urlsplit(candidate)
    if not parts.scheme or not parts.netloc:
        return candidate.rstrip("/")

    return urlunsplit((parts.scheme, parts.netloc, "", "", "")).rstrip("/")


def _normalize_storage_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(config)
    normalized["endpoint"] = _normalize_endpoint(normalized.get("endpoint"))
    normalized["use_ssl"] = _parse_bool(normalized.get("use_ssl", True), default=True)
    for key in ("access_key", "secret_key"):
        if normalized.get(key) == _SENTINEL:
            normalized[key] = ""
    return normalized


def _env_overrides() -> dict[str, Any]:
    """Collect optional env-var overrides (highest priority)."""
    result: dict[str, Any] = {}
    if v := os.getenv("S3_ENDPOINT"):
        result["endpoint"] = v
    if v := os.getenv("S3_ACCESS_KEY"):
        result["access_key"] = v
    if v := os.getenv("S3_SECRET_KEY"):
        result["secret_key"] = v
    if v := os.getenv("S3_BUCKET_NAME"):
        result["bucket_name"] = v
    if v := os.getenv("S3_REGION"):
        result["region"] = v
    if v := os.getenv("S3_USE_SSL"):
        result["use_ssl"] = _parse_bool(v, default=True)
    return result


async def get_storage_config(db: AsyncSession) -> dict[str, Any]:
    """Return the merged storage config: DB settings + env-var overrides.

    Never returns masked sentinel values; missing/masked fields fall back to
    an empty string so callers can detect unconfigured state.
    """
    defaults: dict[str, Any] = StorageSettingsPayload().model_dump()

    try:
        setting = await get_system_setting(db, STORAGE_SETTINGS_MODULE)
        stored: dict[str, Any] = setting.settings if isinstance(setting.settings, dict) else {}
    except Exception:
        stored = {}

    merged = {**defaults, **stored, **_env_overrides()}
    return _normalize_storage_config(merged)


@asynccontextmanager
async def get_s3_client(db: AsyncSession) -> AsyncGenerator[Any, None]:
    """Async context manager that yields a configured aioboto3 S3 client."""
    cfg = await get_storage_config(db)
    async with get_s3_client_from_config(cfg) as client:
        yield client


@asynccontextmanager
async def get_s3_client_from_config(config: dict[str, Any]) -> AsyncGenerator[Any, None]:
    """Async context manager that yields a configured aioboto3 S3 client from a config dict."""
    cfg = _normalize_storage_config(config)
    endpoint = cfg.get("endpoint") or ""
    access_key = cfg.get("access_key") or ""
    secret_key = cfg.get("secret_key") or ""
    region = cfg.get("region") or "us-east-1"
    use_ssl = _parse_bool(cfg.get("use_ssl", True), default=True)

    if not endpoint or not access_key or not secret_key:
        raise RuntimeError("Storage is not configured (endpoint / credentials missing)")

    session = aioboto3.Session()
    async with session.client(  # type: ignore[reportGeneralTypeIssues]
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        use_ssl=use_ssl,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    ) as client:
        yield client

async def test_storage_connection(db: AsyncSession) -> dict[str, Any]:
    """Probe the S3 endpoint and return a structured result dict."""
    cfg = await get_storage_config(db)
    bucket = cfg.get("bucket_name") or ""

    try:
        return await test_storage_connection_from_config(cfg, bucket_name=bucket)

    except RuntimeError as exc:
        return {"success": False, "message": str(exc), "details": {}}
    except (BotoCoreError, ClientError) as exc:
        logger.warning("S3 connection test failed: %s", exc)
        return {"success": False, "message": str(exc), "details": {}}
    except Exception as exc:
        logger.error("Unexpected error during S3 connection test: %s", exc)
        return {"success": False, "message": "Unexpected error – see server logs", "details": {}}


async def test_storage_connection_from_config(config: dict[str, Any], bucket_name: str | None = None) -> dict[str, Any]:
    """Probe the S3 endpoint using an explicit configuration dict."""
    bucket = bucket_name if bucket_name is not None else (config.get("bucket_name") or "")
    try:
        async with get_s3_client_from_config(config) as s3:
            result: dict[str, Any] = {"success": True, "message": "Connection successful", "details": {}}

            if bucket:
                try:
                    await s3.head_bucket(Bucket=bucket)
                    result["bucket_exists"] = True
                    result["message"] = f"Connection successful – bucket '{bucket}' is accessible"
                except ClientError as exc:
                    code = exc.response["Error"]["Code"]
                    if code in ("404", "NoSuchBucket"):
                        result["bucket_exists"] = False
                        result["message"] = f"Connection successful but bucket '{bucket}' does not exist"
                    elif code in ("403", "AccessDenied"):
                        result["bucket_exists"] = True
                        result["message"] = f"Connection successful – bucket '{bucket}' exists (access restricted)"
                    else:
                        result["bucket_exists"] = None
                        result["details"]["bucket_error"] = str(exc)
            return result

    except RuntimeError as exc:
        return {"success": False, "message": str(exc), "details": {}}
    except (BotoCoreError, ClientError) as exc:
        logger.warning("S3 connection test failed: %s", exc)
        return {"success": False, "message": str(exc), "details": {}}
    except Exception as exc:
        logger.error("Unexpected error during S3 connection test: %s", exc)
        return {"success": False, "message": "Unexpected error – see server logs", "details": {}}


async def upload_file(
    db: AsyncSession,
    file_obj: BinaryIO,
    s3_key: str,
    bucket: str | None = None,
    content_type: str = "application/octet-stream",
    extra_args: dict[str, Any] | None = None,
) -> str:
    """Upload *file_obj* to S3 and return the resulting S3 key.

    Args:
        db: Database session (used to load config).
        file_obj: File-like object opened for reading.
        s3_key: Destination path inside the bucket.
        bucket: Override the default bucket from settings.
        content_type: MIME type stored as object metadata.
        extra_args: Extra kwargs forwarded to ``upload_fileobj``.

    Returns:
        The ``s3_key`` that was used.
    """
    cfg = await get_storage_config(db)
    target_bucket = bucket or cfg.get("bucket_name") or ""
    if not target_bucket:
        raise ValueError("No bucket specified and none configured in storage settings")

    upload_kwargs: dict[str, Any] = {"ContentType": content_type}
    if extra_args:
        upload_kwargs.update(extra_args)

    async with get_s3_client(db) as s3:
        await s3.upload_fileobj(file_obj, target_bucket, s3_key, ExtraArgs=upload_kwargs)

    logger.info("Uploaded object s3://%s/%s", target_bucket, s3_key)
    return s3_key


async def delete_file(db: AsyncSession, s3_key: str, bucket: str | None = None) -> None:
    """Delete an object from S3."""
    cfg = await get_storage_config(db)
    target_bucket = bucket or cfg.get("bucket_name") or ""
    if not target_bucket:
        raise ValueError("No bucket specified and none configured in storage settings")

    async with get_s3_client(db) as s3:
        await s3.delete_object(Bucket=target_bucket, Key=s3_key)

    logger.info("Deleted object s3://%s/%s", target_bucket, s3_key)


async def generate_presigned_url(
    db: AsyncSession,
    s3_key: str,
    bucket: str | None = None,
    expiry_seconds: int | None = None,
) -> str:
    """Return a pre-signed GET URL for *s3_key*."""
    cfg = await get_storage_config(db)
    target_bucket = bucket or cfg.get("bucket_name") or ""
    if not target_bucket:
        raise ValueError("No bucket specified and none configured in storage settings")

    expires = expiry_seconds if expiry_seconds is not None else cfg.get("presigned_url_expiry_seconds", 3600)

    async with get_s3_client(db) as s3:
        url: str = await s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": target_bucket, "Key": s3_key},
            ExpiresIn=expires,
        )
    return url
