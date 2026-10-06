import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch
from app.packet_probe import stream_packets


class PacketProbeTests(unittest.TestCase):
    def test_output_is_streamed_and_stderr_is_bounded(self):
        lines=[]
        code,error=stream_packets([sys.executable,'-u','-c',
            "import sys; print('one'); print('two'); sys.stderr.write('x'*100000)"],5,threading.Event(),lines.append)
        self.assertEqual(code,0);self.assertEqual(lines,[b'one\r\n',b'two\r\n'] if sys.platform=='win32' else [b'one\n',b'two\n'])
        self.assertEqual(len(error),65536)

    def test_timeout_cancel_consumer_error_and_ownership_failure_stop_child(self):
        actual=subprocess.Popen
        for mode in ('timeout','cancel','consumer','owner'):
            with self.subTest(mode=mode):
                children=[];event=threading.Event()
                def spawn(*args,**kwargs):
                    child=actual(*args,**kwargs);children.append(child);return child
                def consume(line):
                    if mode=='consumer':raise ValueError('invalid packet')
                    if mode=='cancel':event.set()
                owner=patch('app.packet_probe.own_encoder',side_effect=OSError('owner failure')) if mode=='owner' else patch('app.packet_probe.own_encoder',return_value=None)
                began=time.monotonic()
                with patch('app.packet_probe.subprocess.Popen',side_effect=spawn),owner,self.assertRaises((ValueError,OSError,TimeoutError)):
                    stream_packets([sys.executable,'-u','-c',"import time; print('packet',flush=True); time.sleep(30)"],
                                   .2 if mode=='timeout' else 5,event,consume)
                self.assertLess(time.monotonic()-began,3)
                self.assertIsNotNone(children[0].poll())
