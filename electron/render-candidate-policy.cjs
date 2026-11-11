// Packaging identity only; binary verification and packaged acceptance remain mandatory.
function renderCandidatePolicy(layout, manifest, runtime, pins) {
 const pin = runtime.replayedCandidate ? pins.find(item => item.id === manifest.cohort && item.dllSha256 === manifest.dllSha256) : undefined;
 if(runtime.replayedCandidate && !pin)throw new Error('Unknown native runtime cohort/DLL pair');
 const compatibility = pin?.id.startsWith('mkv-cues-');
 const scope = compatibility ? 'explicit-local-MKV-Cues-compatibility-not-release' : runtime.selfBuiltCandidate ? 'single-display-SDR-D3D11-development-only' : 'local-runtime-layout-candidate-not-packaged-acceptance';
 const knownSchema = layout.schema === 1 || (runtime.selfBuiltCandidate && layout.schema === undefined);
 if(!knownSchema || layout.distributionReady !== false || layout.scope !== scope)throw new Error('Expected a local acceptance runtime layout');
 return {cohort:pin?.id};
}
module.exports = {renderCandidatePolicy};
