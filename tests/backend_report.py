"""Shared verbose unittest output and machine-readable evidence, including failures."""
import contextlib
import json
from pathlib import Path
import re
import sys
import time
import unittest

ROOT=Path(__file__).resolve().parents[1]


class Tee:
    def __init__(self,*streams):self.streams=streams
    def write(self,value):
        for stream in self.streams:stream.write(value);stream.flush()
        return len(value)
    def flush(self):
        for stream in self.streams:stream.flush()


def run(suite,name='normal'):
    if not re.fullmatch('[a-z][a-z0-9-]{0,40}',name):raise ValueError('Invalid report name')
    directory=ROOT/'build/backend-tests'
    directory.mkdir(parents=True,exist_ok=True)
    if not directory.resolve().is_relative_to(ROOT):raise ValueError('Report directory escapes project')
    for suffix in ('log','json'):
        if (directory/f'{name}.{suffix}').is_symlink():raise ValueError('Linked report rejected')
    started=time.monotonic();result=None
    report={'schema':1,'suite':name,'passed':False}
    try:
        with (directory/f'{name}.log').open('w',encoding='utf-8') as log:
            output=Tee(sys.stderr,log)
            with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
                result=unittest.TextTestRunner(stream=output,verbosity=2).run(suite)
        report.update(passed=result.wasSuccessful(),tests=result.testsRun,
            failures=[{'test':test.id(),'traceback':trace} for test,trace in result.failures],
            errors=[{'test':test.id(),'traceback':trace} for test,trace in result.errors],
            skipped=[{'test':test.id(),'reason':reason} for test,reason in result.skipped],
            unexpected_successes=[test.id() for test in result.unexpectedSuccesses],
            expected_failures=[test.id() for test,_ in result.expectedFailures])
        return result
    finally:
        report['elapsed_seconds']=round(time.monotonic()-started,3)
        (directory/f'{name}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
