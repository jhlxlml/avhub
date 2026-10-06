import unittest
from unittest.mock import patch
import test_stability  # Isolated library before importing run.py.
import run as launcher


class ShutdownConfigurationTests(unittest.TestCase):
    def test_server_bounds_http_drain_before_worker_cleanup(self):
        with patch('sys.argv', ['run.py', '--port', '8976']), \
             patch.object(launcher.backend, 'SERVER_PORT', 8765), \
             patch.object(launcher.app.state, 'uvicorn_server', None, create=True), \
             patch.object(launcher.uvicorn, 'Config') as config, \
             patch.object(launcher.uvicorn, 'Server') as server:
            launcher.main()
            self.assertEqual(config.call_args.kwargs['timeout_graceful_shutdown'], 5)
            self.assertEqual(config.call_args.kwargs['host'], '127.0.0.1')
            self.assertEqual(config.call_args.kwargs['port'], 8976)
            self.assertEqual(launcher.app.state.uvicorn_server, server.return_value)
            server.return_value.run.assert_called_once()
            self.assertFalse(hasattr(launcher,'webbrowser'))

    def test_invalid_port_does_not_start_shutdown_capable_server(self):
        with patch('sys.argv', ['run.py', '--port', '65536']), \
             patch.object(launcher.uvicorn, 'Server') as server:
            with self.assertRaises(SystemExit):
                launcher.main()
            server.assert_not_called()
