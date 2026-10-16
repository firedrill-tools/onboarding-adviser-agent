import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { advise, SessionStore, initialSession } from '../src/adviser.js';
import { phraseIn, validateSession } from '../src/schema.js';

const turn = text => ({ reply: 'Noted. What is your primary goal?', updates: [{ field: 'organization', value: text, evidence: text }], openQuestions: ['What is your primary goal?'] });
async function fresh() { const folder = await mkdtemp(join(tmpdir(), 'onboarding-integrity-')); return new SessionStore(join(folder, 'private', 'session.json')); }

test('same-session exclusion starts before generation and preserves the winning turn', async () => {
  const store = await fresh(); let release, entered;
  const started = new Promise(resolve => { entered = resolve; }); const pending = new Promise(resolve => { release = resolve; });
  const first = advise({ store, userText: 'Harbor', generate: async () => { entered(); await pending; return turn('Harbor'); } });
  await started;
  let called = false;
  await assert.rejects(advise({ store: new SessionStore(store.path), userText: 'Delta', generate: async () => { called = true; return turn('Delta'); } }), { code: 'SESSION_BUSY' });
  assert.equal(called, false); release(); await first;
  const session = await store.load(); assert.equal(session.revision, 1); assert.equal(session.requirements.organization, 'Harbor');
  await assert.rejects(access(store.lockPath), { code: 'ENOENT' });
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(store.path, '..'))).mode & 0o777, 0o700);
});

test('separate Node processes obey the same owner lock', async () => {
  const store = await fresh();
  const script = `import { advise,SessionStore } from ${JSON.stringify(new URL('../src/adviser.js', import.meta.url).href)};
    await advise({store:new SessionStore(process.argv[1]),userText:'Harbor',generate:async()=>{
      process.stdout.write('entered\\n');await new Promise(r=>process.stdin.once('data',r));
      return {reply:'Noted',updates:[{field:'organization',value:'Harbor',evidence:'Harbor'}],openQuestions:[]};}});
    process.stdin.destroy();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, store.path], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors += data; });
  const ended = once(child, 'exit');
  try {
    const [ready] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) }); assert.match(String(ready), /entered/);
    await assert.rejects(advise({ store, userText: 'Delta', generate: async () => turn('Delta') }), { code: 'SESSION_BUSY' });
    child.stdin.end('continue'); const [code] = await ended; assert.equal(code, 0, errors);
    assert.equal((await store.load()).requirements.organization, 'Harbor');
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});

test('changed source bytes during a turn refuse publication and preserve the external file', async () => {
  const store = await fresh(); await advise({ store, userText: 'Harbor', generate: async () => turn('Harbor') });
  const original = await readFile(store.path, 'utf8'); const external = original + '\n';
  await assert.rejects(advise({ store, userText: 'Delta', generate: async () => { await writeFile(store.path, external); return turn('Delta'); } }), /session changed/);
  assert.equal(await readFile(store.path, 'utf8'), external);
  await assert.rejects(access(store.lockPath), { code: 'ENOENT' });
});

test('duplicate updates, blank values and partial-word evidence cannot save', async () => {
  for (const updates of [
    [{field:'organization',value:'Harbor',evidence:'Harbor'},{field:'organization',value:'Delta',evidence:'Delta'}],
    [{field:'organization',value:' ',evidence:'Harbor'}],
    [{field:'region',value:'US',evidence:'US'}],
    [{field:'teamSize',value:'12',evidence:'12'}],
  ]) {
    const store = await fresh();
    await assert.rejects(advise({ store, userText: 'Harbor Delta BUSINESS has 120 people.', generate: async () => ({reply:'Noted',updates,openQuestions:[]}) }));
    await assert.rejects(access(store.path), { code: 'ENOENT' });
    await assert.rejects(access(store.lockPath), { code: 'ENOENT' });
  }
  assert.equal(phraseIn('We have 12 people.', '12'), true);
  assert.equal(phraseIn('We have 120 and then 12 people.', '12'), true);
  assert.equal(phraseIn('Quebec', 'quebec'), false);
});

test('malformed stored history and invented provenance reject before generation', async () => {
  for (const mutate of [session => {session.revision = 1;}, session => {session.requirements.region = 'Canada';}, session => {session.extra = 'unknown';}]) {
    const store = await fresh();
    // Create parent through an ordinary zero-update turn, then replace with the invalid snapshot.
    await advise({store,userText:'Hello',generate:async()=>({reply:'What is your organization?',updates:[],openQuestions:['Organization?']})});
    const bad = initialSession(); mutate(bad); await writeFile(store.path, JSON.stringify(bad));
    let called = false;
    await assert.rejects(advise({store,userText:'Harbor',generate:async()=>{called=true;return turn('Harbor');}}));
    assert.equal(called, false); await assert.rejects(access(store.lockPath), {code:'ENOENT'});
  }
});

test('failed writer releases ownership for a later independent turn', async () => {
  const store = await fresh();
  await assert.rejects(advise({store,userText:'Harbor',generate:async()=>{throw new Error('synthetic provider failure');}}),/provider failure/);
  const result = await advise({store,userText:'Harbor',generate:async()=>turn('Harbor')});
  assert.equal(result.revision,1); assert.equal(validateSession(await store.load()).messages.length,2);
});
