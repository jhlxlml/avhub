"""Mandatory local release evidence audit, not the clean-source unit suite.

Missing evidence, skipped checks and failed real artifact audits all fail closed.
No downloads, source/runtime replacement, packaging or publication.
"""
from pathlib import Path
import json
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
SUITES=[
    'test_native_source_replay.ActualReplayEvidenceTests',
    'test_native_dependency_replay.ActualRenderingReplayTests',
    'test_native_media_replay.ActualMediaReplayTests',
    'test_native_replayed_source_materials.ReplayedMaterialsTests',
    'test_native_source_materials.NativeSourceMaterialsTests',
    'test_backend_source_replay.BackendSourceReplayTests',
    'test_native_source_delivery.NativeDeliveryContracts',
]


def accepted(result):
    return result.wasSuccessful() and result.testsRun>0 and not result.skipped


def main():
    sys.path.insert(0,str(ROOT/'tests'))
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromNames(SUITES))
    directory=ROOT/'build/local-build-evidence';directory.mkdir(parents=True,exist_ok=True)
    destination=directory/'result.json'
    if directory.is_symlink() or directory.is_junction() or destination.is_symlink():raise ValueError('Owned evidence output required')
    report={'kind':'mandatory-local-build-evidence','passed':accepted(result),'tests':result.testsRun,
            'skipped':[{'test':test.id(),'reason':reason} for test,reason in result.skipped],
            'failures':[{'test':test.id(),'traceback':trace} for test,trace in result.failures+result.errors],
            'suites':SUITES,'scope':'Audits actual retained build artifacts; not new hardware playback certification'}
    destination.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    if not report['passed']:raise SystemExit(1)


if __name__=='__main__':main()
