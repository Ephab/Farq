"""Local shared-account broker for the Waypoint app (device key in the OS vault). Must not ship in the central service."""
from .router import create_router

__all__ = ["create_router"]
