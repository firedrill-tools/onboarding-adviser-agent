import { generateTurn } from './native.js';
import { Receipt } from './evidence.js';
export { modelFor, generateTurn } from './native.js';
import { fields, TurnSchema, phraseIn } from './schema.js';
export { fields, TurnSchema } from './schema.js';
export { SessionStore, initialSession } from './store.js';

export async function advise({ store, userText, generate = generateTurn, provider, model, baseURL, fetch, signal, timeoutMs = 120000, outputRoot, publish }) {
  if (typeof userText !== 'string' || !userText.trim() || userText.length > 8000) throw new Error('user text must contain 1–8000 characters');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('timeoutMs must be an integer from 1 to 120000');
  const deadline = AbortSignal.timeout(timeoutMs);
  const activeSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let receipt, result, failure;
  try {
    result = await store.withLock(async writer => {
      const current = writer.session;
      receipt = await Receipt.create({store,session:current,initialSha256:writer.initialSha256,userText,provider,model,outputRoot,publish});
      receipt.data.execution_kind = generate === generateTurn ? 'native_ai_sdk' : 'caller_injected_generator';
      await receipt.save(); activeSignal.throwIfAborted();
      if (current.revision >= 40) {receipt.data.execution_kind='model_free_turn_limit';throw new Error('session turn limit (40) reached');}
      const raw = await generate({ session: current, userText, provider, model, baseURL, fetch, signal: activeSignal, receipt });
      receipt.guard(); activeSignal.throwIfAborted();
      receipt.data.raw_turn = structuredClone(raw); await receipt.save();
      const { usage: _usage, ...payload } = raw;
      const turn = TurnSchema.parse(payload);
      const requirements = { ...current.requirements };
      const provenance = { ...current.provenance };
      for (const update of turn.updates) {
        if (!phraseIn(userText, update.evidence)) {
          throw new Error(`ungrounded update for ${update.field}`);
        }
        requirements[update.field] = update.value;
        provenance[update.field] = { turn: current.revision + 1, evidence: update.evidence };
      }
      const next = {
        ...current,
        revision: current.revision + 1,
        requirements,
        provenance,
        openQuestions: turn.openQuestions,
        messages: [
          ...current.messages,
          { role: 'user', content: userText },
          { role: 'assistant', content: turn.reply },
        ],
      };
      receipt.data.state_commit.status = 'prepared'; await receipt.save(); receipt.guard(); activeSignal.throwIfAborted();
      try {
        const committed = await writer.save(next);
        receipt.data.state_commit = {status:'committed',before_sha256:writer.initialSha256,after_sha256:committed.sha256};
      } catch (error) {receipt.data.state_commit.status = 'not_committed_or_unknown'; throw error;}
      const missing = fields.filter(field => !requirements[field]);
      return {
        sessionId: next.sessionId,
        statePath: store.path,
        revision: next.revision,
        reply: turn.reply,
        requirements,
        provenance,
        openQuestions: next.openQuestions,
        missing,
        readyForPlan: missing.length === 0 && next.openQuestions.length === 0,
        usage: raw.usage ?? null,
        reportedUsage: receipt.native ? receipt.native.observations[0]?.reported_usage : null,
        cost_usd: null,
        receiptPath: receipt.path, runId: receipt.data.run_id,
      };
    }, {signal: activeSignal});
  } catch (error) {failure=error;}
  if (receipt) {
    try {await receipt.finish(result,failure);}
    catch (error) {Object.assign(receipt.data,{status:'failed',result:null,evidence_error:String(error.message)});failure??=error;}
  }
  if (failure) {failure.evidence=receipt?.data??null;failure.receiptPath=receipt?.path??null;throw failure;}
  return result;
}
