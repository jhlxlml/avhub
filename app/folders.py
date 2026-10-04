"""Indexed-directory navigation. No disk reads and no source-file mutation."""
import os
from pathlib import Path

from fastapi import HTTPException


def relative_folder(value: str) -> str:
    value = value.replace('\\', '/')
    if not value:
        return ''
    parts = value.split('/')
    if len(value) > 4096 or any(part in ('', '.', '..') or ':' in part or '\x00' in part for part in parts):
        raise HTTPException(400, '子目录必须是媒体目录内的相对路径')
    return '/'.join(parts)


def directory_prefix(root: str, folder: str = '') -> str:
    return str(Path(root).joinpath(*folder.split('/'))).rstrip(os.sep) + os.sep


def like_literal(value: str) -> str:
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def directory_clause(prefix: str, recursive: bool = True):
    clause = "path LIKE ? ESCAPE '\\'"
    args = [like_literal(prefix) + '%']
    if not recursive:
        clause += ' AND instr(substr(path,?),?)=0'
        args += [len(prefix) + 1, os.sep]
    return clause, args
