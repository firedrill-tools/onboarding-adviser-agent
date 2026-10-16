#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';
import { advise, SessionStore, fields } from './adviser.js';
import { initialize, listCases } from './datasets.js';

const help=`Usage: onboarding-adviser list
       onboarding-adviser init --case CASE --state NEW_FILE
       onboarding-adviser show [--state FILE]
       onboarding-adviser say --text "..." --provider openai|anthropic --model MODEL [--state FILE]
       onboarding-adviser say --case CASE --provider openai|anthropic --model MODEL [--state NEW_FILE]
Options: --base-url HTTPS_OR_LOOPBACK --output-root DIRECTORY --timeout SECONDS
A selected case creates an exclusive private copy. show/list/init need no model key.`;
export async function main(argv=process.argv.slice(2)) {
  const controller=new AbortController();let statePath;
  const interrupt=()=>controller.abort(Object.assign(new Error('interrupted'),{name:'AbortError'}));
  try {
    const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{...Object.fromEntries(['state','case','text','provider','model','base-url','output-root','timeout'].map(key=>[key,{type:'string'}])),help:{type:'boolean'}}});
    if(values.help){console.log(help);return 0;}
    const [command='help',...rest]=positionals;if(rest.length)throw new Error('unexpected positional arguments');
    if(command==='help'){console.log(help);return 0;}
    if(!['list','init','show','say'].includes(command))throw new Error('unknown command');
    const allowed={list:[],init:['case','state'],show:['state'],say:['state','case','text','provider','model','base-url','output-root','timeout']}[command];
    if(Object.keys(values).some(key=>!allowed.includes(key)))throw new Error(`unsupported option for ${command}`);
    if(command==='list'){console.log(JSON.stringify(await listCases(),null,2));return 0;}
    if(command==='init'){
      if(!values.case||!values.state)throw new Error('init requires --case and a new --state destination');
      console.log(JSON.stringify(await initialize(values.case,values.state),null,2));return 0;
    }
    statePath=values.state??'.runs/onboarding-session.json';
    if(command==='show'){
      const session=await new SessionStore(statePath).load();console.log(JSON.stringify({...session,statePath:new SessionStore(statePath).path,missing:fields.filter(field=>!session.requirements[field])},null,2));return 0;
    }
    if(values.case&&values.text)throw new Error('a selected case already supplies its user message');
    let userText=values.text;
    if(values.case){statePath=values.state??join(values['output-root']??'.runs','inputs',randomUUID(),'session.json');const selected=await initialize(values.case,statePath);userText=selected.userText;}
    const timeoutMs=values.timeout===undefined?120000:Number(values.timeout)*1000;
    process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
    const result=await advise({store:new SessionStore(statePath),userText,provider:values.provider??'openai',model:values.model??process.env.ONBOARDING_MODEL,baseURL:values['base-url'],outputRoot:values['output-root'],timeoutMs,signal:controller.signal});
    console.log(JSON.stringify(result,null,2));return 0;
  } catch(error) {
    console.error(JSON.stringify({error:error.message,type:error.name,receiptPath:error.receiptPath??null,statePath:statePath??null,stateCommit:error.evidence?.state_commit??null,evidenceError:error.evidence?.evidence_error??null,lockPath:error.lockPath??null}));
    return controller.signal.aborted?130:1;
  } finally {process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
}
const entry=process.argv[1]?await realpath(process.argv[1]).catch(()=>null):null;
if(entry&&import.meta.url===pathToFileURL(entry).href)process.exitCode=await main();
