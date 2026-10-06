"""Bounded playback candidates, independent of the visible library page."""
from pathlib import Path
from fastapi import HTTPException
from .folders import directory_clause, directory_prefix


def selection(current, scope):
    if scope not in ('series', 'directory'):
        raise HTTPException(422, '连播范围无效')
    if scope == 'series' and current['kind'] == 'episode' and (current['series_id'] or (current['title'] or '').strip()):
        # Group IDs intentionally support manually merged series across roots.
        # Legacy, ungrouped titles remain isolated by their library root.
        identity = 'series_id=?' if current['series_id'] else 'series_id IS NULL AND title=? AND root_id IS ?'
        args = [current['series_id']] if current['series_id'] else [current['title'], current['root_id']]
        fields = ['COALESCE(season,1)', 'COALESCE(episode,2147483647)', 'name COLLATE NOCASE', 'id']
        target = [current['season'] if current['season'] is not None else 1,
                  current['episode'] if current['episode'] is not None else 2147483647,
                  current['name'], current['id']]
        return "kind='episode' AND " + identity, args, fields, target, 'series'
    clause, args = directory_clause(directory_prefix(str(Path(current['path']).parent)), False)
    return 'root_id IS ? AND ' + clause, [current['root_id'], *args], ['name COLLATE NOCASE', 'id'], [current['name'], current['id']], 'directory'
