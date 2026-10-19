/** Fresh locked archive outside checkout: CLI/data/native API/state operations. */
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(join(tmpdir(),'onboarding-distribution-'));
const env={...process.env};for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','ONBOARDING_MODEL','NODE_TEST_CONTEXT','NODE_PATH','NODE_OPTIONS'])delete env[key];
for(const key of Object.keys(env))if(key.toLowerCase()==='npm_config_allow_scripts')delete env[key];
const run=(command,args,cwd)=>execFileSync(command,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
try{
  const archive=join(temporary,'source.tar.gz');run(process.execPath,['scripts/package.js',archive],root);
  const entries=run('tar',['-tzf',archive],temporary).split('\n');
  if(!entries.includes('package/firedrill/package-lock.json')||entries.some(name=>name.includes('/node_modules/')||name.includes('/.runs/')))throw new Error('optional execution toolchain source is missing or contains installed/private state');
  run('tar',['-xzf',archive,'-C',temporary],temporary);
  const source=join(temporary,'package');if(!fs.existsSync(join(source,'package-lock.json')))throw new Error('archive lacks lock');
  run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],source);
  run('npm',['ci','--prefix','firedrill','--ignore-scripts','--no-audit','--no-fund'],source);
  run('npm',['test','--prefix','firedrill'],source);
  run(process.execPath,['scripts/generate-data.js','--check'],source);
  const outside=join(temporary,'outside');fs.mkdirSync(outside);const cli=join(source,'src/cli.js');
  run(process.execPath,[cli,'--help'],outside);const manifest=JSON.parse(run(process.execPath,[cli,'list'],outside));if(manifest.cases.length!==10)throw new Error('case list differs');
  for(const item of manifest.cases){const file=join(outside,item.id+'.json');const result=JSON.parse(run(process.execPath,[cli,'init','--case',item.id,'--state',file],outside));if(result.sha256!==item.sha256||(fs.statSync(file).mode&0o777)!==0o600)throw new Error('private copied input differs');}
  const preflight=spawnSync(process.execPath,[cli,'say','--text','We are Harbor.','--model','gpt-4.1','--state',join(outside,'fresh.json')],{cwd:outside,env,encoding:'utf8',timeout:15000});
  if(preflight.status!==1)throw new Error('missing key accepted');const error=JSON.parse(preflight.stderr),receipt=JSON.parse(fs.readFileSync(error.receiptPath));if(receipt.status!=='failed'||receipt.provider_observations.length)throw new Error('bad key-preflight receipt');
  const program=`
const {advise,SessionStore}=await import(process.argv[1]);
const {readFile}=await import('node:fs/promises');
const path=process.argv[2],store=new SessionStore(path);
const result=await advise({store,userText:'Correction: team size is 24, and launch is December.',generate:async({session})=>{
 if(session.revision!==18||session.requirements.organization!=='Harbor Labs')throw Error('history missing');
 return{reply:'Recorded 24 and December.',updates:[{field:'teamSize',value:'24',evidence:'24'},{field:'timeline',value:'December',evidence:'December'}],openQuestions:[]};}});
if(result.revision!==19||result.requirements.region!=='Canada'||result.requirements.teamSize!=='24')throw Error('correction failed');
const evidence=JSON.parse(await readFile(result.receiptPath));if(evidence.execution_kind!=='caller_injected_generator'||evidence.state_commit.status!=='committed')throw Error('evidence differs');`;
  run(process.execPath,['--input-type=module','-e',program,pathToFileURL(join(source,'src/adviser.js')).href,join(outside,'busy.json')],outside);
  console.log('Fresh locked archive verified outside checkout: deterministic ten cases, CLI/help/list/private copies, failed-key receipts and actual busy-session correction/persistence. Injected turn is not live model proof.');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
