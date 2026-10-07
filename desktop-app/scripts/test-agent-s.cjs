// Packaged-worker smoke test. No mouse/keyboard input, screenshots, or API calls.
const assert = require('assert/strict');
const { createAgentS } = require('../src/miraAgentS');
async function main() {
  const worker = createAgentS({ packaged: false });
  try {
    assert.equal((await worker.begin('Open WhatsApp')).kind, 'ready');
    const screen = { image: 'aW1hZ2U=', app: 'Fixture' };
    assert.equal((await worker.predict(screen)).kind, 'model_request');
    assert.deepEqual((await worker.respond('```python\nagent.open_app("WhatsApp")\n```')).action, { type: 'open_app', name: 'WhatsApp' });
    assert.equal((await worker.predict(screen)).kind, 'model_request');
    const done = await worker.respond('```python\nagent.done("WhatsApp is open.")\n```');
    assert.equal(done.done, true);
    assert.equal((await worker.predict(screen)).kind, 'model_request');
    const navigation = await worker.respond('```python\nagent.navigate("https://example.com")\n```');
    assert.deepEqual(navigation.action, { type: 'navigate', url: 'https://example.com', newTab: false });
    assert.equal((await worker.predict(screen)).kind, 'model_request');
    const batch = await worker.respond('```python\nagent.batch([{"type":"key","key":"find"},{"type":"type","text":"Fixture"}])\n```');
    assert.equal(batch.action.type, 'batch');
    assert.equal(batch.action.actions.length, 2);
    worker.stop();
    assert.equal((await worker.begin('Restart fixture')).kind, 'ready');
    console.log('Packaged Agent S startup, prediction, continuity and restart passed.');
  } finally { worker.stop(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
