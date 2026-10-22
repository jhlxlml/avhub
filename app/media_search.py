"""Bounded whole-library search IDs, within the caller's read transaction."""

# Keep memory/SQL parameters independent of the library size. Large result sets
# retain the ordinary indexed page query; no persistent index or cache is built.
MATCH_ID_LIMIT = 1024


def count_and_ids(db, sql, args):
    """sql is the internal SELECT * / NOT INDEXED / WHERE search statement.

    Explicit primary-key order is essential: the remaining count starts AFTER
    the last collected id, rather than rescanning the already examined prefix.
    The caller must keep the probe, count and page in one WAL read snapshot.
    """
    ids = [row[0] for row in db.execute(
        sql.replace('SELECT *', 'SELECT id', 1) + ' ORDER BY id ASC LIMIT ?',
        [*args, MATCH_ID_LIMIT])]
    total = len(ids)
    if total == MATCH_ID_LIMIT:
        remaining = db.execute(
            sql.replace('SELECT *', 'SELECT COUNT(*)', 1) + ' AND id>?',
            [*args, ids[-1]]).fetchone()[0]
        total += remaining
        if remaining:
            return total, None
    return total, ids
