# Native HDR PNG regression fixture

`native-hdr-pq.png` is an application-owned generated chart, not user media.
SHA256: `845d934db210abc63d8fffb161bda9efbf1cdf5f5d0867d0ebbcb973422af8b7`.

Captured on 2026-10-31 by the actual packaged AVHub build
`084031ef4f398db9`, bundled libmpv D3D11 render host, from the owned
`build/libmpv-render-spike/samples/HDR-PQ10-Color-v2-1024x256.mkv`.
Its PNG is 1024×256 RGB, 16-bit, with PQ/BT.2020 cICP, 24-byte mDCV
mastering-display metadata and 10 significant bits recorded by sBIT.
The original screenshot upload failed because the validator rejected mDCV.

The test requires byte-for-byte publication, not an 8-bit or SDR conversion.
This is a metadata/validation regression fixture, not evidence of physical
display brightness, mastering accuracy or HDR certification.
