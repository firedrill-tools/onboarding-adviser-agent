import { generateText, Output } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const fields = ['organization', 'region', 'teamSize', 'primaryGoal', 'timeline'];
export const TurnSchema = z.object({
  reply: z.string().min(1),
  updates: z.array(z.object({
    field: z.enum(fields),
    value: z.string().min(1).nullable(),
    evidence: z.string().min(1),
  })),
  openQuestions: z.array(z.string().min(1)),
});

export function initialSession() {
  return {
    sessionId: randomUUID(),
    revision: 0,
    requirements: Object.fromEntries(fields.map(field => [field, null])),
    provenance: {},
    openQuestions: [],
    messages: [],
  };
}

export class SessionStore {
  constructor(path) { this.path = path; }

  async load() {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return initialSession();
      throw error;
    }
  }

  async save(expectedRevision, next) {
    let current;
    try { current = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      current = null;
    }
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('stale session revision');
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2));
    await rename(temporary, this.path);
  }
}

export function modelFor(provider, model) {
  if (!model) throw new Error('model name is required');
  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model);
  }
  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(model);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

export async function generateTurn({ session, userText, provider, model }) {
  const chosenModel = modelFor(provider, model);
  const recent = session.messages.slice(-12).map(message => ({ role: message.role, content: message.content }));
  const result = await generateText({
    model: chosenModel,
    output: Output.object({ schema: TurnSchema }),
    system: `You are a practical onboarding adviser. Gather the organization, region, team size, primary goal and timeline before proposing a rollout. You can ask a concise next question. The structured current requirements are authoritative history: ${JSON.stringify(session.requirements)}. Apply a correction from the latest user message even when it contradicts an older turn. Only include updates supported by exact wording from the latest user message; copy that wording into evidence. Never invent a requirement or treat previous assistant suggestions as user requirements. If a user retracts a value, set it to null.`,
    messages: [
      ...recent,
      { role: 'user', content: userText },
    ],
  });
  return { ...result.output, usage: result.totalUsage ?? result.usage ?? null };
}

export async function advise({ store, userText, generate = generateTurn, provider, model }) {
  if (!userText?.trim()) throw new Error('user text is required');
  const current = await store.load();
  const raw = await generate({ session: current, userText, provider, model });
  const turn = TurnSchema.parse(raw);
  const requirements = { ...current.requirements };
  const provenance = { ...current.provenance };
  for (const update of turn.updates) {
    if (!userText.toLocaleLowerCase().includes(update.evidence.toLocaleLowerCase())) {
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
  await store.save(current.revision, next);
  const missing = fields.filter(field => !requirements[field]);
  return {
    sessionId: next.sessionId,
    revision: next.revision,
    reply: turn.reply,
    requirements,
    provenance,
    openQuestions: next.openQuestions,
    missing,
    readyForPlan: missing.length === 0 && next.openQuestions.length === 0,
    usage: raw.usage ?? null,
  };
}
