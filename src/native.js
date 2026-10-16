/** Actual AI SDK providers with bounded JSON HTTP and original observations. */
import { generateText, Output } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createHash } from 'node:crypto';
import { TurnSchema } from './schema.js';

export const LIMIT = 1024 * 1024;
export const hash = value => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export const endpoints = {openai:'https://api.openai.com/v1', anthropic:'https://api.anthropic.com/v1'};
export const errorInfo = error => ({name:error?.name ?? 'Error',message:String(error?.message ?? error)});
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function reportedUsage(body, provider) {
  const usage = body?.usage;
  const fields = { input_tokens: count(usage?.input_tokens), output_tokens: count(usage?.output_tokens), total_tokens: count(usage?.total_tokens) };
  return { provider, fields, complete: Object.values(fields).every(value => value !== null), cost_usd: null };
}

export function validateConfig(provider, model, baseURL) {
  if (!Object.hasOwn(endpoints, provider)) throw new Error(`Unsupported provider: ${provider}`);
  if (typeof model !== 'string' || !model.trim() || model.length > 200 || /\s/.test(model)) throw new Error('model name is required without whitespace');
  const url = new URL(baseURL ?? endpoints[provider]);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) throw new Error('base URL requires HTTPS or loopback HTTP without credentials/query/fragment');
  return url.href.replace(/\/$/, '');
}

export function modelFor(provider, model, {baseURL, fetch: fetcher} = {}) {
  const url = validateConfig(provider, model, baseURL);
  const variable = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const apiKey = process.env[variable];
  if (!apiKey) throw new Error(`${variable} is required`);
  return provider === 'openai' ? createOpenAI({apiKey,baseURL:url,fetch:fetcher}).responses(model) : createAnthropic({apiKey,baseURL:url,fetch:fetcher})(model);
}

export function validateCompletion(body, provider) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('provider returned no JSON object');
  if (provider === 'openai') {
    if (body.status !== 'completed' || body.error != null || body.incomplete_details != null) throw new Error(`OpenAI response did not complete (${body.status})`);
    if (!Array.isArray(body.output)) throw new Error('OpenAI output is absent');
    const messages = body.output.filter(item => item.type === 'message');
    if (messages.length !== 1 || body.output.some(item => !['reasoning','message'].includes(item.type) || item.status != null && item.status !== 'completed')) throw new Error('unsupported or incomplete OpenAI output');
    const message = messages[0];
    if (message.role !== 'assistant' || message.status !== 'completed' || !Array.isArray(message.content) || !message.content.length || message.content.some(part => part.type !== 'output_text' || typeof part.text !== 'string') || !message.content.some(part => part.text.trim())) throw new Error('OpenAI final message is absent, unfinished or refused');
  } else {
    if (body.type !== 'message' || body.role !== 'assistant' || body.stop_reason !== 'end_turn' || body.stop_sequence != null) throw new Error(`Anthropic turn did not complete (${body.stop_reason})`);
    if (!Array.isArray(body.content) || !body.content.length || body.content.some(part => part.type !== 'text' || typeof part.text !== 'string') || !body.content.some(part => part.text.trim())) throw new Error('Anthropic output must contain final text only');
  }
}

async function readResponse(response, signal) {
  if (!response.body) return {raw:Buffer.alloc(0),truncated:false};
  const reader = response.body.getReader(); const chunks = []; let length = 0, truncated = false;
  const cancel = () => { reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    while (true) {
      signal?.throwIfAborted();
      const {done,value} = await reader.read();
      if (done) break;
      const remaining = LIMIT - length;
      chunks.push(Buffer.from(value.subarray(0, remaining))); length += Math.min(value.length, remaining);
      if (value.length > remaining) { truncated = true; await reader.cancel('response evidence limit'); break; }
    }
    signal?.throwIfAborted();
    return {raw:Buffer.concat(chunks),truncated};
  } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
  finally { signal?.removeEventListener('abort',cancel); reader.releaseLock(); }
}

export class NativeEvidence {
  constructor(provider, endpoint, publish = async () => {}, guard = () => {}) { this.provider=provider; this.endpoint=endpoint; this.publish=publish; this.guard=guard; this.observations=[]; this.sdk=null; }
  fetch(fetcher, signal) {
    return async (url, options={}) => {
      this.guard(); signal?.throwIfAborted();
      if (this.observations.length) throw new Error('onboarding generation limit (1) reached');
      const expected = this.endpoint + (this.provider === 'openai' ? '/responses' : '/messages');
      if (String(url) !== expected || options.method !== 'POST' || typeof options.body !== 'string') throw new Error('unsupported provider request');
      const raw = Buffer.from(options.body);
      if (raw.length > LIMIT) throw new Error('provider request exceeds 1 MiB');
      const item = {attempt:1,status:'prepared',started_at:now(),finished_at:null,path:new URL(url).pathname,request_sha256:hash(raw),request_body:JSON.parse(options.body),http_status:null,request_id:null,body:null,reported_usage:reportedUsage(null,this.provider),error:null};
      this.observations.push(item); await this.publish(); this.guard(); signal?.throwIfAborted();
      try {
        const response = await fetcher(url, {...options,redirect:'error',signal});
        item.http_status=response.status; item.request_id=response.headers.get('x-request-id') ?? response.headers.get('request-id');
        const {raw:bytes,truncated} = await readResponse(response,signal);
        let body; try { body=JSON.parse(bytes.toString('utf8')); } catch { body=bytes.toString('utf8'); }
        Object.assign(item,{body,truncated,captured_sha256:hash(bytes),body_sha256:truncated?null:hash(bytes),reported_usage:reportedUsage(body,this.provider),response_id:body?.id??null,response_model:body?.model??null,completion:this.provider==='openai'?body?.status??null:body?.stop_reason??null,status:'received'});
        await this.publish(); this.guard(); signal?.throwIfAborted();
        if (truncated) throw new Error('provider response exceeds 1 MiB evidence limit');
        if (response.ok) validateCompletion(body,this.provider);
        item.status=response.ok?'accepted':'http_error'; item.finished_at=now(); await this.publish();
        return new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
      } catch (error) {
        Object.assign(item,{status:'failed',finished_at:now(),error:errorInfo(error)});
        await this.publish(); throw error;
      }
    };
  }
}

export async function generateTurn({session,userText,provider,model,baseURL,fetch:fetcher=globalThis.fetch,signal,receipt}) {
  const endpoint = validateConfig(provider,model,baseURL);
  const native = new NativeEvidence(provider,endpoint,() => receipt?.save(),() => receipt?.guard());
  if (receipt) {receipt.native=native;receipt.data.execution_kind='native_ai_sdk';receipt.data.endpoint=endpoint;await receipt.save();}
  const chosenModel=modelFor(provider,model,{baseURL:endpoint,fetch:native.fetch(fetcher,signal)});
  const recent=session.messages.slice(-12).map(message=>({role:message.role,content:message.content}));
  const system=`You are a practical onboarding adviser. Gather the organization, region, team size, primary goal and timeline before proposing a rollout. You can ask a concise next question. The structured current requirements are authoritative history: ${JSON.stringify(session.requirements)}. Apply a correction from the latest user message even when it contradicts an older turn. Only include one update per field, supported by exact wording from the latest user message; copy that wording into evidence with the same case and whole words/numbers. Never invent a requirement or treat previous assistant suggestions as user requirements. If a user retracts a value, set it to null. Complete requirements are readiness to discuss a plan, not permission for external actions.`;
  if (receipt) {receipt.data.system_sha256=hash(system);await receipt.save();}
  try {
    const result=await generateText({model:chosenModel,output:Output.object({schema:TurnSchema}),system,messages:[...recent,{role:'user',content:userText}],maxRetries:0,maxOutputTokens:2048,abortSignal:signal});
    native.sdk={finishReason:result.finishReason,rawFinishReason:result.rawFinishReason??null,usage:result.usage,totalUsage:result.totalUsage,response_id:result.response.id,response_model:result.response.modelId,steps:result.steps.length};
    await receipt?.save(); receipt?.guard(); signal?.throwIfAborted();
    if (result.finishReason !== 'stop' || result.steps.length !== 1 || result.toolCalls.length) throw new Error('AI SDK did not return a single finished structured turn');
    return {...result.output,usage:result.totalUsage??result.usage??null};
  } catch (error) {error.nativeEvidence={observations:native.observations,sdk:native.sdk};throw error;}
}
