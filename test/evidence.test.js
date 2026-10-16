import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { advise, SessionStore } from '../src/adviser.js';
import { publish } from '../src/evidence.js';
import { bodyFor } from '../fixtures/native.js';

async function fresh(){const root=await mkdtemp(join(tmpdir(),'onboarding-evidence-'));return {root,store:new SessionStore(join(root,'session.json'))};}
for(const phase of ['prepared','response','final'])test(`recording failure at ${phase} refuses a result and states commit truth`,async()=>{
  const {root,store}=await fresh();let calls=0;
  const writer=async(path,data)=>{
    const observation=data.provider_observations[0];
    if(phase==='prepared'&&observation?.status==='prepared'||phase==='response'&&observation?.body||phase==='final'&&data.status==='completed')throw new Error(`synthetic ${phase} recording failure`);
    await publish(path,data);
  };
  await assert.rejects(advise({store,userText:'We are Harbor.',provider:'openai',model:'gpt-4.1',outputRoot:join(root,'runs'),publish:writer,fetch:async()=>{calls++;return Response.json(bodyFor('openai'));}}),error=>{
    assert.equal(error.evidence.status,'failed');assert.equal(error.evidence.result,null);
    if(phase==='final')assert.equal(error.evidence.state_commit.status,'committed');else assert.notEqual(error.evidence.state_commit.status,'committed');
    if(phase==='response')assert.match(error.evidence.evidence_error,/recording failure/);
    return true;
  });
  assert.equal(calls,phase==='prepared'?0:1);
  if(phase==='final')assert.equal((await store.load()).revision,1);else await assert.rejects(access(store.path),{code:'ENOENT'});
  await assert.rejects(access(store.lockPath),{code:'ENOENT'});
});

test('provider context cannot alter current source bytes or erase external edits',async()=>{
  const {root,store}=await fresh();await advise({store,userText:'We are Harbor.',generate:async()=>({reply:'Noted',updates:[{field:'organization',value:'Harbor',evidence:'Harbor'}],openQuestions:[]}),outputRoot:join(root,'runs')});
  const external=(await readFile(store.path,'utf8'))+'\n';
  await assert.rejects(advise({store,userText:'We are Harbor.',provider:'openai',model:'gpt-4.1',outputRoot:join(root,'runs'),fetch:async()=>{await writeFile(store.path,external);return Response.json(bodyFor('openai'));}}),error=>{
    assert.equal(error.evidence.result,null);assert.equal(error.evidence.provider_observations[0].body.id,'resp_synthetic');assert.equal(error.evidence.raw_turn.updates[0].value,'Harbor');return true;
  });
  assert.equal(await readFile(store.path,'utf8'),external);
});

test('a replaced owner lock is retained and cannot authorize a stale publication',async()=>{
  const {root,store}=await fresh(),replacement='owner changed by synthetic test';
  await assert.rejects(advise({store,userText:'We are Harbor.',outputRoot:join(root,'runs'),generate:async()=>{await writeFile(store.lockPath,replacement);return {reply:'Noted',updates:[],openQuestions:[]};}}),/ownership changed/);
  assert.equal(await readFile(store.lockPath,'utf8'),replacement);await assert.rejects(access(store.path),{code:'ENOENT'});await unlink(store.lockPath);
});

test('oversized native response cancels the owned response reader',async()=>{
  const {root,store}=await fresh();let cancelled=false;
  await assert.rejects(advise({store,userText:'We are Harbor.',provider:'openai',model:'gpt-4.1',outputRoot:join(root,'runs'),fetch:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1024*1024+1));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})}),error=>{assert.equal(error.evidence.provider_observations[0].truncated,true);assert.equal(error.evidence.provider_observations[0].body_sha256,null);return true;});
  assert.equal(cancelled,true);
});
