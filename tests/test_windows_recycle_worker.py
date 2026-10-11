"""Transport harness: no Shell process, bin enumeration or file mutation."""
import io
import json
import unittest
from unittest.mock import patch
from app.windows_recycle import WindowsRecycle


class Process:
    def __init__(self):self.stdin=io.StringIO();self.stdout=io.StringIO();self.exited=False;self.killed=False
    def poll(self):return 0 if self.exited else None
    def terminate(self):self.exited=True
    def kill(self):self.killed=True;self.exited=True
    def wait(self,timeout):return 0


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.worker=WindowsRecycle();self.processes=[];self.addCleanup(self.worker.close)
        def start():self.worker.process=Process();self.processes.append(self.worker.process);self.worker.stats['starts']+=1
        patcher=patch.object(self.worker,'_start',side_effect=start);patcher.start();self.addCleanup(patcher.stop)
    def test_worker_reuse_and_exact_string_identity_transport(self):
        stamp=[2**63+5,2**100+1,123,1791687758037655800]
        with patch.object(self.worker,'_reply',return_value={'result':True}):
            self.worker.items();self.worker.delete('owned-placeholder',stamp)
        self.assertEqual(len(self.processes),1)
        command=json.loads(self.processes[0].stdin.getvalue().splitlines()[1]);self.assertEqual(command['stamp'],[str(v) for v in stamp])
    def test_timeout_does_not_replay_and_closes_only_owned_worker(self):
        with patch.object(self.worker,'_reply',side_effect=OSError('timeout')) as reply:
            with self.assertRaises(OSError):self.worker.delete('owned-placeholder',[1,2,3,4])
            self.assertEqual(reply.call_count,1)
        self.assertEqual(len(self.processes),1);self.assertTrue(self.processes[0].exited);self.assertIsNone(self.worker.process)
    def test_old_idle_timer_cannot_close_a_reused_active_worker(self):
        with patch.object(self.worker,'_reply',return_value={'result':[]}):
            self.worker.items();old_timer=self.worker.timer;self.worker.items();old_timer.function()
        self.assertFalse(self.processes[0].exited);self.worker.timer.function();self.assertTrue(self.processes[0].exited)
