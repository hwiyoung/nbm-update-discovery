"""SQLAlchemy 엔진 / 세션 골조.

이정표 1: 본 모듈은 import 만 가능하게 둔다 (실제 DB 연결은 이정표 4부터).
이정표 4: Base / 모델 정의 + Alembic 연결.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    """모든 ORM 모델의 베이스. 이정표 4 에서 모델 정의 시작."""


_settings = get_settings()
engine = create_engine(_settings.database_url, future=True, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Iterator[Session]:
    """FastAPI Depends 용 세션 제공자."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
