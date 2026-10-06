import unittest
import tempfile
from pathlib import Path,PureWindowsPath
from unittest.mock import patch
import test_stability
from app import main as m
from app.path_index import RootPathIndex
from check_path_alias import short_path

class CanonicalPathTests(unittest.TestCase):
    def test_registration_alias_deduplicates_and_nested_roots_are_owned_once(self):
        with tempfile.TemporaryDirectory(prefix='avhub-real-alias-root-') as directory:
            canonical=Path(directory).resolve();alias=short_path(canonical)
            if alias is None:self.skipTest('Windows 8.3 alias unavailable')
            nested=canonical/'nested';nested.mkdir()
            (canonical/'parent.mp4').write_bytes(b'owned read-only test source')
            (nested/'child.mp4').write_bytes(b'owned child test source')
            with m.connection() as db:db.execute('DELETE FROM roots');db.execute('DELETE FROM media')
            root=m.add_root(m.RootInput(path=str(alias)));duplicate=m.add_root(m.RootInput(path=str(canonical)))
            child=m.add_root(m.RootInput(path=str(alias/'nested')))
            self.assertEqual(root['id'],duplicate['id']);self.assertEqual(root['path'],str(canonical));self.assertEqual(child['path'],str(nested))
            calls=[]
            class Manager:
                from threading import Event
                cancelled=Event()
                def update(self,**kwargs):pass
                def discovered(self):pass
                def advance(self,*args):pass
                def error(self,*args):raise AssertionError(args)
            with patch.object(m,'scan_file',side_effect=lambda root_id,path,*a,**k:calls.append((root_id,path.name)) or True):
                m.run_scan([root,child],Manager())
            self.assertEqual(sorted(calls),sorted([(root['id'],'parent.mp4'),(child['id'],'child.mp4')]))
            self.assertEqual((canonical/'parent.mp4').read_bytes(),b'owned read-only test source')
    def test_root_trie_remains_disk_free_for_ten_thousand_roots(self):
        roots=[(i,PureWindowsPath(f'D:/offline/root-{i}')) for i in range(10000)]
        with patch.object(Path,'resolve',side_effect=AssertionError('unexpected filesystem resolution')):
            index=RootPathIndex(roots)
            self.assertEqual(index.owner(PureWindowsPath('D:/offline/root-9999/sub/video.mp4')),9999)
