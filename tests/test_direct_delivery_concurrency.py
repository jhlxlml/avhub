import threading
import tempfile
import unittest
from pathlib import Path
import test_stability  # Owns the isolated test database, never the user's library.
from app import main as m


class DirectDeliveryConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='avhub-direct-concurrency-')
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'owned.mp4'
        self.source.write_bytes(b'owned sample')
        with m.connection() as db:
            db.execute('DELETE FROM media')
            db.execute('INSERT INTO media(id,path,name,title,ext,missing,created_at,updated_at) VALUES(1,?,?,?,?,0,0,0)',
                       (str(self.source), 'owned.mp4', 'owned', '.mp4'))

    def test_range_response_creation_does_not_wait_for_write_mutex(self):
        done = threading.Event()
        errors = []
        def query():
            try:
                response = m.media_file(1)
                self.assertEqual(Path(response.path), self.source)
            except BaseException as exc:
                errors.append(exc)
            finally:
                done.set()
        with m.DB_LOCK:
            worker = threading.Thread(target=query)
            worker.start()
            finished_while_locked = done.wait(2)
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(finished_while_locked, 'Read-only video lookup must bypass the writer mutex')

    def test_restore_gate_still_protects_path_lookup(self):
        entered = threading.Event()
        done = threading.Event()
        def query():
            entered.set()
            try:
                m.media_file(1)
            finally:
                done.set()
        with m.DB_READ_GATE.write():
            worker = threading.Thread(target=query)
            worker.start()
            self.assertTrue(entered.wait(2))
            self.assertFalse(done.wait(.1), 'Restore must continue to block new path readers')
        self.assertTrue(done.wait(2))
        worker.join(2)
