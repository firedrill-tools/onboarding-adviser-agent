import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Output } from 'ai';
import { advise, SessionStore, TurnSchema, modelFor } from '../src/adviser.js';

async function freshStore() {
  const folder = await mkdtemp(join(tmpdir(), 'firedrill-onboarding-'));
  return new SessionStore(join(folder, 'session.json'));
}

test('AI SDK structured output schema is constructed', () => {
  assert.ok(Output.object({ schema: TurnSchema }));
});

test('a correction replaces a requirement while other facts and history remain', async () => {
  const store = await freshStore();
  const first = await advise({
    store,
    userText: 'We are Harbor Labs in the US, with 12 teammates. We need to onboard support.',
    generate: async () => ({
      reply: 'What is your rollout timeline?',
      updates: [
        { field: 'organization', value: 'Harbor Labs', evidence: 'Harbor Labs' },
        { field: 'region', value: 'US', evidence: 'US' },
        { field: 'teamSize', value: '12', evidence: '12 teammates' },
        { field: 'primaryGoal', value: 'onboard support', evidence: 'onboard support' },
      ],
      openQuestions: ['What is your timeline?'],
    }),
  });
  assert.equal(first.revision, 1);
  assert.equal(first.readyForPlan, false);
  const second = await advise({
    store,
    userText: 'Correction: the region is Canada, not US. We want to launch in November.',
    generate: async ({ session }) => {
      assert.equal(session.requirements.region, 'US');
      assert.equal(session.messages.length, 2);
      return {
        reply: 'I have Canada and November. Does the 12-person team size still hold?',
        updates: [
          { field: 'region', value: 'Canada', evidence: 'region is Canada' },
          { field: 'timeline', value: 'November', evidence: 'launch in November' },
        ],
        openQuestions: ['Confirm team size'],
      };
    },
  });
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.requirements.region, 'Canada');
  assert.equal(second.requirements.primaryGoal, 'onboard support');
  assert.equal(second.provenance.region.turn, 2);
  assert.equal((await store.load()).messages.length, 4);
});

test('ungrounded model update and provider failure do not change saved state', async () => {
  const store = await freshStore();
  await assert.rejects(advise({
    store, userText: 'We want support onboarding.',
    generate: async () => ({
      reply: 'Okay', updates: [{ field: 'region', value: 'Canada', evidence: 'Canada' }], openQuestions: [],
    }),
  }), /ungrounded/);
  await assert.rejects(advise({
    store, userText: 'We want support onboarding.',
    generate: async () => { throw new Error('provider unavailable'); },
  }), /provider unavailable/);
  await assert.rejects(readFile(store.path));
});

test('retraction removes a value and keeps its evidence', async () => {
  const store = await freshStore();
  await advise({
    store, userText: 'The launch is in November.',
    generate: async () => ({reply: 'Noted', updates: [{field: 'timeline', value: 'November', evidence: 'November'}], openQuestions: []}),
  });
  const result = await advise({
    store, userText: 'Actually, remove November; the date is undecided.',
    generate: async () => ({reply: 'I cleared the timeline.', updates: [{field: 'timeline', value: null, evidence: 'remove November'}], openQuestions: ['What is the new timeline?']}),
  });
  assert.equal(result.requirements.timeline, null);
  assert.ok(result.missing.includes('timeline'));
  assert.equal(result.provenance.timeline.turn, 2);
});

test('stale revision cannot overwrite a newer session', async () => {
  const store = await freshStore();
  const session = await store.load();
  const next = { ...session, revision: 1, messages: [{role:'user',content:'Hello'},{role:'assistant',content:'What is your organization?'}] };
  await store.save(0, next);
  await assert.rejects(store.save(0, next), /stale/);
});

test('unknown provider and missing model are explicit', () => {
  assert.throws(() => modelFor('openai', ''), /model name/);
  assert.throws(() => modelFor('other', 'example'), /Unsupported provider/);
});
