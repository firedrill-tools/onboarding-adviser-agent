import { open, mkdir, unlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBounded } from './store.js';
import { validateSession } from './schema.js';
import { hash } from './native.js';

export const dataRoot=fileURLToPath(new URL('../data/',import.meta.url));
export async function loadManifest(root=dataRoot){
  root=resolve(root);const raw=await readBounded(resolve(root,'manifest.json')),manifest=JSON.parse(raw);
  if(manifest.id!=='synthetic-onboarding-cases'||manifest.version!==1||manifest.synthetic!==true||!Array.isArray(manifest.cases)||!manifest.cases.length)throw new Error('invalid dataset manifest');
  const ids=new Set(),files=new Set();
  for(const item of manifest.cases){
    if(!item||typeof item.id!=='string'||!item.id.trim()||ids.has(item.id)||!['starter','busy','ambiguous','boundary'].includes(item.profile))throw new Error('invalid or duplicate case identity');ids.add(item.id);
    if(typeof item.file!=='string'||!item.file||isAbsolute(item.file)||item.file.split(/[\\/]/).includes('..')||files.has(item.file))throw new Error('invalid case path');files.add(item.file);
    if(typeof item.userText!=='string'||!item.userText.trim()||item.userText.length>8000)throw new Error('invalid case utterance');
    const target=await realpath(resolve(root,item.file)),realRoot=await realpath(root),inside=relative(realRoot,target);
    if(inside.startsWith('..'+sep)||isAbsolute(inside)||inside==='..')throw new Error('case path escapes dataset');
    const bytes=await readBounded(target),session=validateSession(JSON.parse(bytes));
    if(hash(bytes)!==item.sha256)throw new Error('case hash differs');
    const expected={id:manifest.id,version:1,profile:item.profile,case_id:item.id};
    if(!Object.entries(expected).every(([key,value])=>session.dataset?.[key]===value)||session.revision!==item.prior_turns||session.importedHistory?.origin!=='synthetic_human_authored'||session.importedHistory.turns!==session.revision)throw new Error('case identity/history differs');
  }
  return {manifest,manifestSha256:hash(raw),root};
}
export async function listCases(root){const {manifest,manifestSha256}=await loadManifest(root);return {...manifest,manifestSha256};}
export async function select(caseId,root){
  const {manifest,manifestSha256,root:directory}=await loadManifest(root),item=manifest.cases.find(item=>item.id===caseId);
  if(!item)throw new Error('unknown case');const bytes=await readBounded(resolve(directory,item.file));if(hash(bytes)!==item.sha256)throw new Error('case changed before selection');
  return {item,bytes,session:validateSession(JSON.parse(bytes)),manifestSha256};
}
export async function initialize(caseId,path,root){
  const selected=await select(caseId,root);path=resolve(path);await mkdir(dirname(path),{recursive:true,mode:0o700});const descriptor=await open(path,'wx',0o600);
  try{try{await descriptor.writeFile(selected.bytes);await descriptor.sync();}finally{await descriptor.close();}}
  catch(error){await unlink(path);throw error;}
  return {statePath:path,dataset:selected.session.dataset,sha256:selected.item.sha256,manifestSha256:selected.manifestSha256,userText:selected.item.userText,priorTurns:selected.session.revision};
}
