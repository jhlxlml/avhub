"""User runtime hook runs before bundled application imports SQLite."""
from app.sqlite_runtime import initialize
initialize()
