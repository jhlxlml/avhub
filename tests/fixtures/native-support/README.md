# Pinned source metadata fixtures

These three public Ubuntu DSC metadata files are copied byte-for-byte from the
SHA256-pinned inputs in `ci/native-support-sources.json`. Their origin URLs,
versions, sizes and hashes remain in that lock file. Tests verify the original
DSC hashes and the complete payload SHA256 sections; no source archives or native
binaries are included here. DSC signature authenticity, runtime execution and
redistribution approval are not inferred from these parser fixtures.
