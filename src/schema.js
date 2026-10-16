import { z } from 'zod';

export const fields = ['organization', 'region', 'teamSize', 'primaryGoal', 'timeline'];
const wording = limit => z.string().min(1).max(limit).refine(text => Boolean(text.trim()), 'wording cannot be blank');
export const TurnSchema = z.object({
  reply: wording(4000),
  updates: z.array(z.object({ field: z.enum(fields), value: wording(500).nullable(), evidence: wording(4000) }).strict()).max(5)
    .refine(updates => new Set(updates.map(update => update.field)).size === updates.length, 'duplicate field update'),
  openQuestions: z.array(wording(500)).max(5),
}).strict();

export function phraseIn(text, evidence) {
  let position = text.indexOf(evidence);
  const word = character => character !== undefined && /[\p{L}\p{N}_]/u.test(character);
  while (position >= 0) {
    const before = [...text.slice(0, position)].at(-1), after = [...text.slice(position + evidence.length)][0];
    if (!(word([...evidence][0]) && word(before)) && !(word([...evidence].at(-1)) && word(after))) return true;
    position = text.indexOf(evidence, position + 1);
  }
  return false;
}

const SessionSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  dataset: z.object({id:wording(100),version:z.literal(1),profile:z.enum(['starter','busy','ambiguous','boundary']),case_id:wording(100)}).strict().nullable().default(null),
  importedHistory: z.object({origin:z.literal('synthetic_human_authored'),turns:z.number().int().min(0).max(40)}).strict().nullable().default(null),
  sessionId: z.uuid(), revision: z.number().int().min(0).max(40),
  requirements: z.object(Object.fromEntries(fields.map(field => [field, wording(500).nullable()]))).strict(),
  provenance: z.partialRecord(z.enum(fields), z.object({ turn: z.number().int().min(1).max(40), evidence: wording(4000) }).strict()),
  openQuestions: z.array(wording(500)).max(5),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: wording(8000) }).strict()).max(80),
}).strict();

export function validateSession(value) {
  const session = SessionSchema.parse(value);
  if (session.importedHistory && session.importedHistory.turns > session.revision) throw new Error('imported history exceeds session revision');
  if (session.messages.length !== session.revision * 2 || session.messages.some((message, index) => message.role !== (index % 2 ? 'assistant' : 'user'))) throw new Error('session revision/history mismatch');
  for (const field of fields) {
    const origin = session.provenance[field];
    if (session.requirements[field] !== null && !origin) throw new Error(`missing provenance for ${field}`);
    if (origin && (origin.turn > session.revision || !phraseIn(session.messages[(origin.turn - 1) * 2].content, origin.evidence))) throw new Error(`invalid stored provenance for ${field}`);
  }
  return session;
}

export function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
