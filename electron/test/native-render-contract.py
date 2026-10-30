"""Read-only generated-fixture probe for the real native host matrix."""
import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
from app.native_playback import probe_render_source

source = Path(sys.argv[1]).resolve()
source.relative_to(root / 'build' / 'libmpv-render-spike' / 'samples')


def run(args, timeout):
    result = subprocess.run(args, timeout=timeout, capture_output=True)
    return result.returncode, result.stdout, result.stderr


print(json.dumps(probe_render_source(source, run, str(root / 'bin' / 'ffprobe.exe'))))
