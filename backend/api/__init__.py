"""DroneMedic — API package.

Lazy re-export of the FastAPI app so that both launch commands work:
  uvicorn backend.api:app   (legacy)
  uvicorn backend.app:app   (canonical)
"""


def __getattr__(name: str):
    if name == "app":
        from backend.app import app
        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
