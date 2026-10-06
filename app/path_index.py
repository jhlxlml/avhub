"""Deepest registered directory lookup in O(path depth), not O(root count)."""
import os
from pathlib import PurePath


class RootPathIndex:
    # Paths are canonicalized by registration/relocation. Keep this trie
    # strictly lexical: resolving thousands of offline roots would block scans.
    _owner = object()

    def __init__(self, roots):
        self.tree = {}
        for root_id, path in roots:
            node = self.tree
            for part in path.parts:
                node = node.setdefault(os.path.normcase(part), {})
            node.setdefault(self._owner, root_id)

    def owner(self, path: PurePath):
        node = self.tree
        owner = None
        for part in path.parts:
            node = node.get(os.path.normcase(part))
            if node is None:
                break
            owner = node.get(self._owner, owner)
        return owner
