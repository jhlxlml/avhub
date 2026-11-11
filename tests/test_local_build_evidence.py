"""Evidence-gate contracts only; these never certify native artifacts."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('local_evidence_gate',ROOT/'scripts/verify-local-build-evidence.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)


class LocalEvidenceGateTests(unittest.TestCase):
    def test_missing_or_skipped_evidence_cannot_pass_release_gate(self):
        result=Mock(testsRun=1,skipped=[('native','missing inputs')]);result.wasSuccessful.return_value=True
        self.assertFalse(gate.accepted(result));result.skipped=[];result.testsRun=0
        self.assertFalse(gate.accepted(result));result.testsRun=1;result.wasSuccessful.return_value=False
        self.assertFalse(gate.accepted(result));result.wasSuccessful.return_value=True
        self.assertTrue(gate.accepted(result))

    def test_release_preparation_invokes_strict_real_evidence_gate(self):
        import ast
        tree=ast.parse((ROOT/'scripts/prepare-desktop-release-inputs.py').read_text(encoding='utf-8'))
        calls=[node for node in ast.walk(tree) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and isinstance(node.func.value,ast.Name) and node.func.value.id=='subprocess' and node.func.attr=='run']
        invocation=next(call for call in calls if any(isinstance(node,ast.Constant) and node.value=='scripts/verify-local-build-evidence.py' for node in ast.walk(call)))
        self.assertTrue(any(k.arg=='check' and isinstance(k.value,ast.Constant) and k.value.value is True for k in invocation.keywords))
        self.assertTrue({'test_native_source_replay.ActualReplayEvidenceTests',
                         'test_native_dependency_replay.ActualRenderingReplayTests',
                         'test_native_media_replay.ActualMediaReplayTests',
                         'test_native_replayed_source_materials.ReplayedMaterialsTests',
                         'test_native_source_materials.NativeSourceMaterialsTests',
                         'test_backend_source_replay.BackendSourceReplayTests',
                         'test_native_source_delivery.NativeDeliveryContracts'}.issubset(gate.SUITES))
