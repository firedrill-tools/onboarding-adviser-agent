import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { errorInfo, hash, now, reportedUsage } from './native.js';
import { readBounded } from './store.js';

const require=createRequire(import.meta.url);
async function versions() {
  const values={node:process.version};
  for (const name of ['ai','@ai-sdk/openai','@ai-sdk/anthropic','zod']) {
    let directory=dirname(require.resolve(name));
    for (let attempt=0;attempt<4;attempt++,directory=dirname(directory)) {
      try {const pkg=JSON.parse(await readBounded(join(directory,'package.json')));if(pkg.name===name){values[name]=pkg.version;break;}}
      catch (error) {if(error.code!=='ENOENT')throw error;}
    }
    if(!values[name])throw new Error(`cannot identify installed ${name}`);
  }
  return values;
}

export async function publish(path,data) {
  const temporary=`${path}.${randomUUID()}.tmp`;
  try {
    const staged=await open(temporary,'wx',0o600);
    try {await staged.writeFile(JSON.stringify(data,null,2)+'\n');await staged.sync();}finally{await staged.close();}
    await rename(temporary,path);
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export class Receipt {
  static async create({store,session,initialSha256,userText,provider,model,outputRoot,publish:writer=publish}) {
    const runId=randomUUID(),root=resolve(outputRoot??'.runs');await mkdir(root,{recursive:true,mode:0o700});const directory=join(root,runId);await mkdir(directory,{mode:0o700});
    const path=join(directory,'receipt.json');
    return new Receipt(path,writer,{schema_version:1,run_id:runId,receipt_path:path,status:'running',execution_kind:'not_started',started_at:now(),finished_at:null,versions:await versions(),provider:provider??null,requested_model:model??null,state_path:store.path,session_id:session.sessionId,revision:session.revision,dataset:session.dataset,imported_history:session.importedHistory,user_text:userText,user_text_sha256:hash(userText),initial_state_sha256:initialSha256,provider_observations:[],normalized_sdk:null,reported_usage:reportedUsage(null,provider),raw_turn:null,state_commit:{status:'not_attempted',before_sha256:initialSha256,after_sha256:null},result:null,error:null});
  }
  constructor(path,writer,data){this.path=path;this.writer=writer;this.data=data;this.native=null;this.recordingError=null;}
  guard(){if(this.recordingError)throw this.recordingError;}
  async save(){
    if(this.native){this.data.provider_observations=structuredClone(this.native.observations);this.data.normalized_sdk=structuredClone(this.native.sdk);this.data.reported_usage=this.data.provider_observations[0]?.reported_usage??reportedUsage(null,this.data.provider);}
    try{await this.writer(this.path,this.data);}catch(error){this.recordingError=error;throw error;}
  }
  async finish(result,error){
    Object.assign(this.data,{status:error?'failed':'completed',finished_at:now(),result:error?null:result});
    if(error){const causes=[];let current=error;while(current&&causes.length<5){causes.push(errorInfo(current));current=current.cause;}this.data.error={...errorInfo(error),causes};}
    await this.save();
  }
}
