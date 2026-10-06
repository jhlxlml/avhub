import argparse
import os
import sys
import uvicorn

# The dedicated migration command must not import/create a media library.
# Normal launches keep the established module interface for shutdown tooling.
if sys.argv[1:2]!=['--migrate-data']:
    from app.main import app
    from app import main as backend


def main():
    if sys.argv[1:2]==['--migrate-data']:
        if len(sys.argv)!=5:raise SystemExit('Usage: --migrate-data SOURCE TARGET ID')
        from app.data_migration import migrate
        migrate(*sys.argv[2:]);return
    parser = argparse.ArgumentParser(description="AVHub internal Electron media service; use npm run dev to open the desktop app")
    parser.add_argument("--port", type=int, default=int(os.environ.get("AVHUB_PORT", "8765")))
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    backend.SERVER_PORT = args.port
    # Paused video streams and disconnected clients must not drain forever on
    # desktop shutdown (or Ctrl+C during diagnostics). Finish writes, then cancel
    # remaining HTTP tasks before the lifespan stops scanning / FFmpeg workers.
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port,
                                          log_level="warning", timeout_graceful_shutdown=5))
    app.state.uvicorn_server = server
    server.run()


if __name__ == "__main__":
    main()
