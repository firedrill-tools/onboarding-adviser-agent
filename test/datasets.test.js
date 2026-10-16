import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, stat, cp, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { advise, SessionStore } from '../src/adviser.js';
import { dataRoot, listCases, select, initialize, loadManifest } from '../src/datasets.js';
import { bodyFor } from '../fixtures/native.js';

async function temporary(){return mkdtemp(join(tmpdir(),'onboarding-data-'));}
test('ten hash-bound cases preserve human history and exclusive private copies',async()=>{
  const manifest=await listCases(),root=await temporary();assert.equal(manifest.cases.length,10);assert.deepEqual(new Set(manifest.cases.map(c=>c.profile)),new Set(['starter','busy','ambiguous','boundary']));
  for(const item of manifest.cases){
    const chosen=await select(item.id),path=join(root,item.id,'session.json'),copy=await initialize(item.id,path);
    assert.equal(copy.sha256,item.sha256);assert.deepEqual(await readFile(path),chosen.bytes);assert.equal((await stat(path)).mode&0o777,0o600);
    assert.equal(chosen.session.importedHistory.origin,'synthetic_human_authored');assert.equal(chosen.session.revision,item.prior_turns);
    await assert.rejects(initialize(item.id,path),{code:'EEXIST'});assert.deepEqual(await readFile(path),chosen.bytes);
  }
});

test('actual native busy correction retains requirements outside the recent message window',async()=>{
  const root=await temporary(),path=join(root,'busy.json'),copy=await initialize('busy',path),before=(await select('busy')).bytes;let request;
  const turn={reply:'I recorded 24 teammates and December.',updates:[{field:'teamSize',value:'24',evidence:'24'},{field:'timeline',value:'December',evidence:'December'}],openQuestions:[]};
  const result=await advise({store:new SessionStore(path),userText:copy.userText,provider:'openai',model:'gpt-4.1',outputRoot:join(root,'receipts'),fetch:async(_url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify(bodyFor('openai',turn)),{headers:{'content-type':'application/json'}});}});
  assert.equal(result.revision,19);assert.equal(result.requirements.organization,'Harbor Labs');assert.equal(result.requirements.region,'Canada');assert.equal(result.requirements.teamSize,'24');assert.equal(result.requirements.timeline,'December');assert.equal(result.provenance.region.turn,2);
  const prompt=JSON.stringify(request.input);assert.match(prompt,/Harbor Labs/);assert.match(prompt,/support onboarding/);assert.equal(prompt.includes('Eighteen prior human-authored turns'),false);assert.equal(prompt.includes('synthetic-onboarding-cases'),false);
  const receipt=JSON.parse(await readFile(result.receiptPath));assert.equal(receipt.imported_history.turns,18);assert.equal(receipt.provider_observations.length,1);assert.equal(receipt.dataset.case_id,'busy');
  assert.deepEqual((await select('busy')).bytes,before);
});

for(const fault of ['hash','identity','path','symlink','history'])test(`manifest ${fault} fails before initialization`,async()=>{
  const root=await temporary(),data=join(root,'data');await cp(dataRoot,data,{recursive:true});const manifest=JSON.parse(await readFile(join(data,'manifest.json'))),item=manifest.cases[0],target=join(data,item.file);
  if(fault==='hash')await writeFile(target,(await readFile(target,'utf8'))+'\n');
  if(fault==='identity')item.id='other';
  if(fault==='path')item.file='../outside.json';
  if(fault==='symlink'){const outside=join(root,'outside.json');await writeFile(outside,await readFile(target));await unlink(target);await symlink(outside,target);}
  if(fault==='history')item.prior_turns++;
  await writeFile(join(data,'manifest.json'),JSON.stringify(manifest));await assert.rejects(loadManifest(data));
});
