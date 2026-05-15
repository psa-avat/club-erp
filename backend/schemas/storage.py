"""
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - storage: Pydantic schemas for S3-compatible object storage configuration
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

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

STORAGE_SETTINGS_MODULE = "storage"

MASKED_VALUE = "***"


class StorageSettingsPayload(BaseModel):
    """Writable S3 settings.  Secret fields accept the masked sentinel
    ``***`` to mean "keep existing value"."""

    endpoint: str = Field(default="", description="S3-compatible endpoint URL (e.g. http://localhost:9000)")
    access_key: str = Field(default="", description="Access key ID")
    secret_key: str = Field(default="", description="Secret access key (write-only; read back as ***)")
    bucket_name: str = Field(default="", description="Default bucket name")
    region: str = Field(default="us-east-1", description="Region name (use any value for self-hosted)")
    use_ssl: bool = Field(default=True, description="Enforce HTTPS when True")
    presigned_url_expiry_seconds: int = Field(
        default=3600,
        ge=60,
        le=604800,
        description="Default expiry for pre-signed download URLs (60 s – 7 days)",
    )


class StorageSettingsResponse(BaseModel):
    module_name: str
    settings: dict[str, Any]
    updated_at: datetime
    updated_by: Optional[int] = None

    class Config:
        from_attributes = True


class StorageConnectionTestResponse(BaseModel):
    success: bool
    message: str
    bucket_exists: Optional[bool] = None
    details: dict[str, Any] = Field(default_factory=dict)
