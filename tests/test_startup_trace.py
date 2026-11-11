import io
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from app import startup_trace as trace


class StartupTraceTests(unittest.TestCase):
    def test_non_desktop_import_does_not_arm_or_print(self):
        with patch.multiple(trace,_desktop=False,_armed=False,_ready=False),patch.object(trace.sys,'stderr',io.StringIO()) as output,patch.object(trace.faulthandler,'dump_traceback_later') as arm:
            trace.begin();trace.mark('schema-ready');trace.ready()
            self.assertEqual(output.getvalue(),'');arm.assert_not_called()

    def test_health_cancels_watchdog_once_and_stops_stage_output(self):
        with patch.multiple(trace,_desktop=True,_armed=False,_ready=False),patch.object(trace.sys,'stderr',io.StringIO()) as output,patch.object(trace.faulthandler,'dump_traceback_later') as arm,patch.object(trace.faulthandler,'cancel_dump_traceback_later') as cancel:
            trace.begin();trace.mark('schema-start');trace.ready();trace.ready();trace.mark('later-operation')
            arm.assert_called_once();cancel.assert_called_once()
            self.assertIn('health-ready',output.getvalue());self.assertNotIn('later-operation',output.getvalue())
            self.assertNotIn('AVHUB_SESSION_TOKEN',output.getvalue())

    def test_real_stalled_child_emits_stack_then_health_cancels(self):
        result=subprocess.run([sys.executable,'-c',"from app import startup_trace as s;import time;s.begin();time.sleep(11);s.ready()"],cwd=Path(__file__).resolve().parents[1],env={**os.environ,'AVHUB_SESSION_TOKEN':'owned-startup-token','PYTHONIOENCODING':'utf-8'},capture_output=True,text=True,timeout=18)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('python-entry',result.stderr);self.assertIn('Timeout',result.stderr);self.assertIn('health-ready',result.stderr)
        self.assertNotIn('owned-startup-token',result.stderr)
