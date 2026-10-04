from functools import lru_cache
from pathlib import Path
import subprocess
import sys
import time

STARTED = time.monotonic()


@lru_cache(maxsize=4)
def tool_version(executable: str) -> str:
    try:
        result = subprocess.run([executable, '-version'], capture_output=True, timeout=3,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return result.stdout.decode('utf-8', errors='replace').splitlines()[0][:200] if result.returncode == 0 else '无法运行'
    except (OSError, subprocess.TimeoutExpired, IndexError): return '不可用或检查超时'


def report(data: Path, database: Path, build: dict, desktop: bool, frozen: bool, tools: dict, playback) -> dict:
    with playback.lock:
        sessions = list(playback.sessions.values())
        active = {'tasks': len(sessions), 'throttled_tasks': sum(item.throttled for item in sessions),
                  'cache_bytes': sum(item.cache_bytes for item in sessions), 'cache_target_bytes_per_task': playback.cache_target,
                  'pending_cleanup': len(playback.pending_removals), 'ahead_seconds': playback.ahead_seconds, 'back_seconds': playback.back_seconds}
    return {'build': build, 'mode': 'Electron 便携版' if desktop and frozen else 'Electron 开发模式' if desktop else '浏览器本地服务',
            'data_dir': str(data), 'database': str(database), 'frozen': frozen, 'python': sys.version.split()[0],
            'uptime_seconds': round(time.monotonic() - STARTED), 'tools': {name: tool_version(command) for name, command in tools.items()},
            'playback': active}
