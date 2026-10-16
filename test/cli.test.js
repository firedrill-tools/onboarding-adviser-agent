/** Actual child CLI and native AI SDK with loopback HTTP; no provider network. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bodyFor } from '../fixtures/native.js';

const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
function environment(keys=true){const env={...process.env,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};delete env.ONBOARDING_MODEL;delete env.OPENAI_API_KEY;delete env.ANTHROPIC_API_KEY;if(keys){env.OPENAI_API_KEY='synthetic-cli-key';env.ANTHROPIC_API_KEY='synthetic-cli-key';}return env;}
function child(args,root,keys=true){
  const process=spawn(globalThis.process.execPath,[cli,...args],{cwd:root,env:environment(keys),stdio:['ignore','pipe','pipe']});let out='',err='';process.stdout.on('data',data=>{out+=data;});process.stderr.on('data',data=>{err+=data;});
  const done=once(process,'close').then(([code])=>({code,out,err}));return {process,done};
}
async function invoke(args,root,keys=true){const run=child(args,root,keys);const timeout=setTimeout(()=>run.process.kill('SIGKILL'),20000);try{return await run.done;}finally{clearTimeout(timeout);}}
async function temporary(){return mkdtemp(join(tmpdir(),'onboarding-cli-'));}
async function endpoint(handler){const requests=[];const server=createServer(async(req,res)=>{const parts=[];for await(const data of req)parts.push(data);const request={path:req.url,body:JSON.parse(Buffer.concat(parts))};requests.push(request);await handler(request,res);});server.listen(0,'127.0.0.1');await once(server,'listening');return {requests,url:`http://127.0.0.1:${server.address().port}/v1`,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};}

for(const provider of ['openai','anthropic'])test(`${provider} CLI retains two native turns and corrections`,async()=>{
  const root=await temporary(),state=join(root,'session.json');let turns=0;
  const server=await endpoint((_request,res)=>{const turn=turns++?{reply:'I recorded Canada.',updates:[{field:'region',value:'Canada',evidence:'Canada'}],openQuestions:[]}:undefined;res.writeHead(200,{'content-type':'application/json','x-request-id':'cli-request'});res.end(JSON.stringify(bodyFor(provider,turn)));});
  try{
    const args=['--state',state,'--provider',provider,'--model',provider==='openai'?'gpt-4.1':'claude-sonnet-4-6','--base-url',server.url];
    const first=await invoke(['say','--text','We are Harbor.',...args],root);assert.equal(first.code,0,first.err);
    const next=await invoke(['say','--text','Our region is Canada.',...args],root);assert.equal(next.code,0,next.err);const result=JSON.parse(next.out);
    assert.equal(result.revision,2);assert.equal(result.requirements.organization,'Harbor');assert.equal(result.requirements.region,'Canada');assert.equal(result.provenance.region.turn,2);
    assert.equal(server.requests.length,2);assert.equal(server.requests[0].path,provider==='openai'?'/v1/responses':'/v1/messages');
    const evidence=JSON.parse(await readFile(result.receiptPath));assert.equal(evidence.state_commit.status,'committed');assert.equal(evidence.provider_observations[0].request_id,'cli-request');assert.equal(JSON.stringify(evidence).includes('synthetic-cli-key'),false);
    const shown=await invoke(['show','--state',state],root,false);assert.equal(shown.code,0);assert.equal(JSON.parse(shown.out).messages.length,4);
  }finally{await server.close();}
});

for(const fault of ['partial','503'])test(`CLI ${fault} refuses a committed turn and emits evidence`,async()=>{
  const root=await temporary(),state=join(root,'session.json');
  const server=await endpoint((_request,res)=>{const body=bodyFor('openai');if(fault==='partial')body.status='incomplete';res.writeHead(fault==='503'?503:200,{'content-type':'application/json'});res.end(JSON.stringify(body));});
  try{const result=await invoke(['say','--text','We are Harbor.','--state',state,'--model','gpt-4.1','--base-url',server.url],root);assert.equal(result.code,1);assert.equal(result.out,'');const data=JSON.parse(await readFile(JSON.parse(result.err).receiptPath));assert.equal(data.status,'failed');assert.equal(data.result,null);assert.equal(server.requests.length,1);await assert.rejects(access(state),{code:'ENOENT'});}finally{await server.close();}
});

for(const signal of ['SIGINT','SIGTERM'])test(`CLI ${signal} aborts native HTTP, releases ownership and saves failed evidence`,async()=>{
  const root=await temporary(),state=join(root,'session.json');let ready,disconnected=false;const entered=new Promise(resolve=>{ready=resolve;});
  const server=await endpoint((_request,res)=>{res.on('close',()=>{disconnected=true;});ready();});
  const run=child(['say','--text','We are Harbor.','--state',state,'--model','gpt-4.1','--base-url',server.url],root);const timer=setTimeout(()=>run.process.kill('SIGKILL'),20000);
  try{await Promise.race([entered,run.done.then(result=>{throw new Error(`CLI stopped before request: ${result.err}`);})]);run.process.kill(signal);const result=await run.done;assert.equal(result.code,130,result.err);assert.equal(result.out,'');const data=JSON.parse(await readFile(JSON.parse(result.err).receiptPath));assert.equal(data.status,'failed');assert.equal(data.provider_observations[0].status,'failed');assert.equal(data.state_commit.status,'not_attempted');await assert.rejects(access(state+'.lock'),{code:'ENOENT'});await assert.rejects(access(state),{code:'ENOENT'});}finally{clearTimeout(timer);if(run.process.exitCode===null)run.process.kill('SIGKILL');await server.close();}
  assert.equal(disconnected,true);
});

test('CLI model-free listing/private copy/turn limit and failed-key preflight',async()=>{
  const root=await temporary();const listing=await invoke(['list'],root,false);assert.equal(listing.code,0);assert.equal(JSON.parse(listing.out).cases.length,10);
  const path=join(root,'busy.json');assert.equal((await invoke(['init','--case','busy','--state',path],root,false)).code,0);assert.equal((await invoke(['init','--case','busy','--state',path],root,false)).code,1);
  const limit=await invoke(['say','--case','turn-limit'],root,false);assert.equal(limit.code,1);const limited=JSON.parse(await readFile(JSON.parse(limit.err).receiptPath));assert.equal(limited.execution_kind,'model_free_turn_limit');assert.equal(limited.provider_observations.length,0);
  const failed=await invoke(['say','--text','We are Harbor.','--state',join(root,'new.json'),'--model','gpt-4.1'],root,false);assert.equal(failed.code,1);const evidence=JSON.parse(await readFile(JSON.parse(failed.err).receiptPath));assert.equal(evidence.status,'failed');assert.equal(evidence.provider_observations.length,0);
  const invalid=await invoke(['say','--unknown'],root,false);assert.equal(invalid.code,1);assert.equal(invalid.out,'');
});
