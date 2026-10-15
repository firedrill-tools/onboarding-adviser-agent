# Multi-turn onboarding adviser

A standalone CLI conversation using Vercel's AI SDK v7. It collects five onboarding requirements over several turns, keeps user corrections and retractions, and stores the conversation in a JSON session file. The model returns one structured object per turn: a reply, requirement updates backed by exact wording from the latest user message, and open questions.

## Run

Requires Node.js 20+, npm and either an OpenAI or Anthropic model key for live turns.

```sh
npm ci
npm test
OPENAI_API_KEY=... npm run advise -- say \
  --provider openai --model YOUR_ENABLED_MODEL \
  --state .runs/harbor.json \
  --text 'We are Harbor Labs in the US with 12 teammates.'
npm run advise -- show --state .runs/harbor.json
```

For Anthropic, use `--provider anthropic` and `ANTHROPIC_API_KEY`. `ONBOARDING_MODEL` can supply the model name instead of `--model`. The app does not guess a model supported by the account. Each `say` invocation calls the chosen provider once through `generateText` with `Output.object` and a Zod schema. It saves only after a valid model result. A generated field update is rejected unless its `evidence` occurs in the latest user message.

The session file is for one local writer at a time; the revision check detects sequential stale writes but is not a cross-process lock. A generated value can still misinterpret the cited phrase, so inspect the stored value and provenance for live turns. The first five fields being present is a readiness signal for a plan, not approval to perform any real onboarding action.

## Evidence and integration

[Scenario briefs](scenarios/README.md) cover ordinary intake, corrections, retractions, missing details and provider failure. Six offline tests pass with scripted model outputs; they validate state handling, not live model quality. Provider usage and conversation success remain unmeasured until an account key is available. No external onboarding service is called.

Firedrill integration will be added only against its verified new release. This repository is private and has no selected public license.

Implementation reference: [AI SDK v7 structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data).
