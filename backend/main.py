"""    
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Backend API principale
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
import os
import logging
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal, init_db, engine
from api.security import get_current_user, get_user_capabilities, get_user_roles
from api.routes import auth, admin, members, accounting, assets, flights, flight_packs, federal_sync, gesasso, helloasso, member_portal, planche, storage, vi
from models import User
from gestionlog import LogConfig
from services.accounting import ensure_default_journals, ensure_default_system_settings



# Configuration
API_VERSION = "1.0.0"
APP_NAME = "ERP-CLUB API"
APP_DESCRIPTION = "Multi-user ERP for gliding clubs - manage pilots, aircraft, flights, and integrate with FFVP and Gesasso"
LICENSE = "GNU Affero General Public License v3.0"

# Environment configuration
env_mode = os.getenv("ENVIRONMENT", "DEV").upper()
is_production = env_mode == "PROD"

# Logging setup - intercept all logging and forward to loguru
LogConfig.setup_logging()


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events"""
    gesasso_scheduler_task = None

    # Startup
    logger.info(f"Starting {APP_NAME} v{API_VERSION}")
    logger.info(f"Environment: {env_mode}")
    logger.info(
        f"CORS mode: {'wildcard' if allow_all_origins else 'restricted'} | "
        f"origins: {'*' if allow_all_origins else ', '.join(cors_origins)}"
    )
    
    # Initialize database tables (if not using Alembic migrations)
    try:
        await init_db()
        logger.info("Database initialized successfully")

        async with AsyncSessionLocal() as db:
            settings_seed_result = await ensure_default_system_settings(db)
            logger.info(
                "Default system settings ensured: inserted={} total_defaults={}",
                settings_seed_result.get("inserted"),
                settings_seed_result.get("total_defaults"),
            )

            journals_seed_result = await ensure_default_journals(db)
            logger.info(
                "Default journals ensured: inserted={} reactivated={} total_defaults={}",
                journals_seed_result.get("inserted"),
                journals_seed_result.get("reactivated"),
                journals_seed_result.get("total_defaults"),
            )
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise
    
    # Log all registered routes for diagnostics
    logger.info(f"Registered {len(app.routes)} routes:")
    for route in app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            methods = ",".join(route.methods)
            logger.info(f"  {methods:10} {route.path}")


       
    yield
    
    # Shutdown
    logger.info("Shutting down API")
    
    if engine:
        await engine.dispose()


# Create FastAPI app
app = FastAPI(
    title=APP_NAME,
    description=APP_DESCRIPTION,
    version=API_VERSION,
    lifespan=lifespan,
    docs_url=None if is_production else "/api/v1/docs",
    redoc_url=None if is_production else "/api/v1/redoc",
    openapi_url=None if is_production else "/api/v1/openapi.json",
)

# CORS middleware
raw_cors_origins = os.getenv("CORS_ORIGINS", "*")
cors_origins = [origin.strip() for origin in raw_cors_origins.split(",") if origin.strip()]
allow_all_origins = "*" in cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else cors_origins,
    allow_credentials=not allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all HTTP requests"""
    timestamp = datetime.now().strftime("%d/%m %H:%M:%S")
    client_ip = request.client.host if request.client else "unknown"

    logger.info(
        f"[{timestamp}] {client_ip} - {request.method} {request.url.path}"
    )

    response = await call_next(request)
    return response


from api.dependencies import get_db


# --- API ENDPOINTS ---

@app.get("/api/v1/")
async def read_root():
    """Root endpoint with API information"""
    return {
        "app": APP_NAME,
        "version": API_VERSION,
        "description": APP_DESCRIPTION,
        "license": LICENSE,
        "environment": env_mode,
        "docs": "/api/v1/docs" if not is_production else None,
    }


@app.get("/health")
async def health_check():
    """Health check endpoint - returns immediately without database dependency"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "CLUB ERP-back",
    }


@app.get("/health/db")
async def health_check_db(db: AsyncSession = Depends(get_db)):
    """Database health check - verifies database connectivity"""
    try:
        # Simple database query to verify connection
        await db.execute(text("SELECT 1"))
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "database": "connected",
        }
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        raise HTTPException(
            status_code=503,
            detail="Database connection failed"
        )


@app.get("/api/v1/info")
async def api_info(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """API version and information endpoint"""
    roles = await get_user_roles(db=db, user_id=current_user.id)
    capabilities = await get_user_capabilities(db=db, user_id=current_user.id)
    return {
        "name": APP_NAME,
        "version": API_VERSION,
        "api_version": "v1",
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "roles": roles,
            "capabilities": capabilities,
        },
        "features": [
            "multi-user logbook",
            "FFVP integration",
            "Gesasso data caching",
            "PlancheDeVol linking",
        ],
    }


app.include_router(auth.router, prefix="/api/v1/auth", tags=["authentication"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(members.router, prefix="/api/v1/members", tags=["members"])
app.include_router(accounting.router)
app.include_router(assets.router)
app.include_router(helloasso.router)
app.include_router(flights.router)
app.include_router(federal_sync.router)
app.include_router(planche.router)
app.include_router(gesasso.router)
app.include_router(vi.router)
app.include_router(storage.router)
app.include_router(flight_packs.router)
app.include_router(member_portal.router)


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=not is_production,
        log_level="debug" if not is_production else "info",
    )
