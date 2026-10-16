/** Real AI SDK/adapter JSON HTTP through its public fetch option. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { advise, SessionStore } from '../src/adviser.js';

import { TURN, bodyFor } from '../fixtures/native.js';
async function fresh() {const root=await mkdtemp(join(tmpdir(),'onboarding-native-'));return {root,store:new SessionStore(join(root,'session.json'))};}
function options(provider,context,fetch) {return {store:context.store,userText:'We are Harbor.',provider,model:provider==='openai'?'gpt-4.1':'claude-sonnet-4-6',fetch,outputRoot:join(context.root,'observations')};}
function script(body,status=200) {
  const calls=[];
  return {calls,fetch:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body),signal:init.signal});return new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json','x-request-id':'synthetic-request'}});}};
}

for(const provider of ['openai','anthropic']) {
  test(`${provider}: actual native completed turn commits with private original evidence`,async()=>{
    const context=await fresh(),body=bodyFor(provider),transport=script(body);
    const result=await advise(options(provider,context,transport.fetch));
    assert.equal(result.revision,1);assert.equal(result.requirements.organization,'Harbor');assert.equal(result.readyForPlan,false);
    assert.equal(transport.calls.length,1);assert.equal(transport.calls[0].body.model,provider==='openai'?'gpt-4.1':'claude-sonnet-4-6');
    assert.equal(transport.calls[0].body[provider==='openai'?'max_output_tokens':'max_tokens'],2048);
    const evidence=JSON.parse(await readFile(result.receiptPath));
    assert.equal(evidence.status,'completed');assert.equal(evidence.state_commit.status,'committed');assert.equal(evidence.provider_observations[0].body.unknown_field.retained,true);
    assert.equal(evidence.normalized_sdk.finishReason,'stop');assert.equal(evidence.provider_observations[0].request_id,'synthetic-request');
    assert.equal(evidence.reported_usage.fields.total_tokens,provider==='openai'?15:null);assert.equal(evidence.reported_usage.cost_usd,null);
    assert.equal(evidence.provider_observations[0].request_body.model,transport.calls[0].body.model);
    assert.equal(JSON.stringify(evidence).includes('synthetic-openai-key'),false);assert.equal(JSON.stringify(evidence).includes('synthetic-anthropic-key'),false);
    assert.equal(evidence.versions.ai,'7.0.141');assert.equal((await context.store.load()).revision,1);
    await assert.rejects(access(context.store.lockPath),{code:'ENOENT'});
  });
  for(const kind of ['partial','absent','tool','refused','invalid-json','oversized']) {
    test(`${provider}: ${kind} response never commits`,async()=>{
      const context=await fresh();let body=bodyFor(provider);
      if(provider==='openai') {
        if(kind==='partial'){body.status='incomplete';body.incomplete_details={reason:'max_output_tokens'};}
        if(kind==='absent')delete body.status;
        if(kind==='tool')body.output.push({type:'function_call',id:'call',call_id:'call',name:'external_action',arguments:'{}',status:'completed'});
        if(kind==='refused')body.output[0].content=[{type:'refusal',refusal:'Synthetic refusal'}];
      } else {
        if(kind==='partial')body.stop_reason='max_tokens';if(kind==='absent')delete body.stop_reason;
        if(kind==='tool'){body.stop_reason='tool_use';body.content.push({type:'tool_use',id:'call',name:'external_action',input:{}});}
        if(kind==='refused')body.stop_reason='refusal';
      }
      if(kind==='invalid-json')body='{not-json';if(kind==='oversized')body=JSON.stringify(body)+' '.repeat(1024*1024);
      const transport=script(body);
      await assert.rejects(advise(options(provider,context,transport.fetch)),error=>{
        assert.equal(error.evidence.status,'failed');assert.equal(error.evidence.result,null);assert.equal(error.evidence.state_commit.status,'not_attempted');assert.equal(error.evidence.provider_observations.length,1);assert.ok(error.receiptPath);return true;
      });
      assert.equal(transport.calls.length,1);await assert.rejects(access(context.store.path),{code:'ENOENT'});await assert.rejects(access(context.store.lockPath),{code:'ENOENT'});
    });
  }
  test(`${provider}: one 503 attempt retains failed raw usage`,async()=>{
    const context=await fresh(),body={error:{type:'synthetic_unavailable',message:'Synthetic unavailable'},usage:bodyFor(provider).usage},transport=script(body,503);
    await assert.rejects(advise(options(provider,context,transport.fetch)),error=>{
      assert.equal(error.evidence.provider_observations[0].http_status,503);assert.deepEqual(error.evidence.provider_observations[0].body,body);assert.equal(error.evidence.reported_usage.fields.input_tokens,10);return true;
    });
    assert.equal(transport.calls.length,1);await assert.rejects(access(context.store.path),{code:'ENOENT'});
  });
  for(const usage of ['missing','zero','partial','invalid']) {
    test(`${provider}: raw ${usage} usage never becomes guessed measurement`,async()=>{
      const context=await fresh(),body=bodyFor(provider);
      if(usage==='missing')delete body.usage;
      if(usage==='zero')body.usage={input_tokens:0,output_tokens:0,...provider==='openai'?{total_tokens:0}:{}};
      if(usage==='partial')body.usage={input_tokens:7};
      if(usage==='invalid')body.usage={input_tokens:-1,output_tokens:'5',total_tokens:true};
      const transport=script(body);let data;
      try {const result=await advise(options(provider,context,transport.fetch));data=JSON.parse(await readFile(result.receiptPath));}
      catch(error){data=error.evidence;assert.equal(data.result,null);}
      assert.deepEqual(data.provider_observations[0].body,body);
      const counts=data.reported_usage.fields;
      if(usage==='zero'){assert.equal(counts.input_tokens,0);assert.equal(counts.output_tokens,0);assert.equal(counts.total_tokens,provider==='openai'?0:null);}
      if(usage==='missing'||usage==='invalid')assert.deepEqual(counts,{input_tokens:null,output_tokens:null,total_tokens:null});
      if(usage==='partial')assert.deepEqual(counts,{input_tokens:7,output_tokens:null,total_tokens:null});
      assert.equal(transport.calls.length,1);assert.equal(data.reported_usage.cost_usd,null);
    });
  }
}

for(const kind of ['cancel','deadline']) {
  test(`${kind}: native signal stops pending fetch, keeps state unchanged and releases owner`,async()=>{
    const context=await fresh();let entered;const started=new Promise(resolve=>{entered=resolve;});const controller=new AbortController();let aborted=false;
    const fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>{entered();signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});});
    const task=advise({...options('openai',context,fetch),signal:controller.signal,timeoutMs:kind==='deadline'?1000:120000});
    await Promise.race([started,task.then(()=>{throw new Error('completed before fetch');})]);if(kind==='cancel')controller.abort(new Error('synthetic cancellation'));
    await assert.rejects(task,error=>{assert.equal(error.evidence.status,'failed');assert.equal(error.evidence.provider_observations[0].status,'failed');return true;});
    assert.equal(aborted,true);await assert.rejects(access(context.store.lockPath),{code:'ENOENT'});await assert.rejects(access(context.store.path),{code:'ENOENT'});
    const recovered=await advise(options('openai',context,script(bodyFor('openai')).fetch));assert.equal(recovered.revision,1);
  });
}

for(const provider of ['openai','anthropic'])test(`${provider}: native SDK schema failure after completion cannot publish`,async()=>{
  const context=await fresh(),body=bodyFor(provider);
  if(provider==='openai')body.created_at='not-a-timestamp';else body.id=42;
  const transport=script(body);
  await assert.rejects(advise(options(provider,context,transport.fetch)),error=>{
    assert.equal(error.evidence.status,'failed');assert.equal(error.evidence.result,null);assert.deepEqual(error.evidence.provider_observations[0].body,body);assert.equal(error.evidence.provider_observations[0].status,'accepted');assert.equal(error.evidence.normalized_sdk,null);assert.equal(error.evidence.reported_usage.fields.input_tokens,10);return true;
  });
  await assert.rejects(access(context.store.path),{code:'ENOENT'});assert.equal(transport.calls.length,1);
});
