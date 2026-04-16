from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal


async def get_db() -> AsyncSession:
    """Yield one async SQLAlchemy session per request."""
    async with AsyncSessionLocal() as session:
        yield session
