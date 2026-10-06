export default async function teardown() {
  await fetch('http://127.0.0.1:8877/test/shutdown', { method: 'POST', signal: AbortSignal.timeout(1500) }).catch(() => {});
  // Allow the isolated server to close its processes and temporary directory on Windows.
  for (let i = 0; i < 30; i++) {
    try { await fetch('http://127.0.0.1:8877/api/health', { signal: AbortSignal.timeout(500) }); }
    catch { return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
