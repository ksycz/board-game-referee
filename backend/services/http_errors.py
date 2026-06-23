"""HTTP error helpers."""

from __future__ import annotations

import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)

GENERIC_SERVER_ERROR = "An internal error occurred. Please try again."
GENERIC_BGG_LOOKUP_ERROR = "Could not look up game on BoardGameGeek."


def server_error(context: str, exc: Exception) -> HTTPException:
    logger.exception("%s failed", context)
    return HTTPException(status_code=500, detail=GENERIC_SERVER_ERROR)
