import unittest
from unittest.mock import patch
import test_stability
from app import main as m
class DesktopPolicyTests(unittest.TestCase):
    def test_browser_os_routes_are_retired_and_internal_path_resolution_remains(self):
        routes={route.path for route in m.app.routes}
        for path in ('/api/roots/pick','/api/roots/{root_id}/relocate/pick','/api/screenshots/pick','/api/app-data/reveal','/api/media/{media_id}/native/{action}'):
            self.assertNotIn(path,routes)
        self.assertIn('/api/media/{media_id}/native-path',routes)
        self.assertFalse(hasattr(m,'pick_root'))
    def test_renderer_harness_is_explicit_and_disabled_in_frozen_builds(self):
        with patch.object(m.app.state,'renderer_test',False,create=True):self.assertFalse(m.health()['renderer_test'])
        with patch.object(m.app.state,'renderer_test',True,create=True),patch.object(m,'FROZEN',False):self.assertTrue(m.health()['renderer_test'])
        with patch.object(m.app.state,'renderer_test',True,create=True),patch.object(m,'FROZEN',True):self.assertFalse(m.health()['renderer_test'])
