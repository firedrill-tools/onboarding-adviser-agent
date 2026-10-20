# Multi-turn onboarding adviser with Vercel AI SDK

A standalone conversation CLI using Vercel AI SDK v7, with configurable OpenAI or Anthropic models. It gathers organization, region, team size, primary goal and timeline, preserves corrections/retractions and stores requirements with evidence from the latest user message. It calls no external onboarding service.

This example repository is publicly viewable. A project license has not been selected.

## Simulate with Firedrill

[Firedrill](https://firedrill.run/) is a simulation platform for AI agents.
Start from this repository’s root:

```sh
npx firedrill-run init
```

Sign in and choose your project, then follow the [simulation run guide](firedrill/README.md)
for application dependencies, a preview and the reviewed scenarios. Your agent runs
locally or in your CI; model credentials stay separate from Firedrill sign-in.
The included recipes record outcomes without an automatic quality score or CI gate.

## Run

Node.js 22+ and npm:

```sh
npm ci
npm test
npm run advise -- list
npm run advise -- init --case busy --state .runs/my-session.json
npm run advise -- show --state .runs/my-session.json
```

These commands need no model key. Export OPENAI_API_KEY or ANTHROPIC_API_KEY and an enabled model, then:

```sh
npm run advise -- say --state .runs/my-session.json --provider openai --model YOUR_ENABLED_MODEL --text 'Correction: team size is 24, and launch is December.'
npm run advise -- say --case starter --provider anthropic --model YOUR_ENABLED_MODEL
```

`ONBOARDING_MODEL` can supply the model. There is no assumed model default. `--base-url` selects an explicit HTTPS or loopback HTTP provider endpoint (normally ending in /v1). `--timeout` sets a positive deadline up to 120 seconds; `--output-root` chooses private run evidence. `.env.example` documents variables; the CLI does not load .env automatically. A selected `say --case` makes a new exclusive private input copy, automatically choosing a unique path unless `--state NEW_FILE` is supplied. It never overwrites an existing session. To continue an initialized session, use `say --text`.

## Conversation and state

Each native turn uses actual generateText/Output.object with a strict Zod schema, one model request and no SDK retry. OpenAI Responses must be completed with a completed assistant text message; Anthropic Messages must end_turn with final text. Partial, absent completion, refusals, unexpected tool output and invalid structured data do not update state. One request has at most 2048 output tokens and 1 MiB request/decoded-response evidence; an oversized response reader is cancelled. These limits are application bounds, not measured provider capacity or billing.

Only the most recent 12 messages and all current requirements enter model context. Corrections update the named field, retractions set it to null, and other requirements/provenance remain. Updates require an exact case-sensitive phrase from the latest user message, with whole-word/number boundaries. Duplicate field updates and blank values fail. A phrase's occurrence does not prove that the model interpreted intent correctly: quoted instructions, ambiguity and normalized values need live/human review. Assistant suggestions are not confirmed user requirements.

`readyForPlan` means all five fields are present and no open questions remain. It is readiness to discuss a plan, never permission for an external action. `show` displays actual saved requirements/history; no separate success animation or fabricated model reply exists.

Sessions are bounded to 40 turns/80 alternating user-assistant messages and 2 MiB, with strict identity/history/provenance checks. An exclusive 0600 owner lock covers loading, generation and publication. A second local process receives SESSION_BUSY before making a model call. Revision and exact byte checks reject stale or externally changed state; staged writes are 0600, fsynced and atomically renamed. New parent directories are 0700. Cooperative writers must all use SessionStore; arbitrary external editors are detected at the final checks but do not participate in the lock protocol.

Locks are released on ordinary success, failure, cancellation and deadlines. A hard-killed process can leave a lock: inspect its PID/token and stop its writer before manually removing that exact stale lock. The app never takes over by age. A replaced owner's lock is retained. Use a new private case copy for reset; stop any writer and preserve its receipts before discarding old state. Reset does not erase provider retention or billing. Original v0.1 sessions are structurally validated and gain schema metadata on their next successful save.

## Evidence and retry decisions

Each turn writes `.runs/<uuid>/receipt.json` (0700 new directories, 0600 file), or your output root. It records actual dependency versions, task/system/source hashes, declared dataset/imported history, original prepared request and decoded response before SDK validation, provider IDs/completion/usage, normalized SDK usage separately, raw structured turn, state-commit phase and error causes. Source text/model output are private business data; headers and keys are not recorded.

Missing, partial, malformed and explicit-zero raw counts remain distinct. Anthropic does not report a total in this qualified path: total_tokens stays null, even if the SDK derives a total. Raw failed-attempt counts survive. Cost is null. A prepared observation does not prove a provider executed the request; synthetic fixture counts are not live usage or billing.

Recording failure before commit refuses state publication. A failure after a committed save can leave the new conversation in place while the API exits with an error. Inspect `stateCommit`, the receipt and `show` before retrying; the app does not blindly repeat the turn. If final evidence publication fails, the last file may remain running/prepared and in-memory `evidence_error` plus commit status identify what the caller observed. Trusted injected generators are labeled caller_injected_generator and do not qualify provider behavior.

The CLI emits JSON results to stdout, JSON errors/receipt paths to stderr and nonzero status on failure; SIGINT/SIGTERM abort native work and exit 130. The HTTP fetch implementation/connection pool belongs to its caller/runtime. Per-turn signals and response readers are owned by the application; it does not close a shared global pool. See [COMPATIBILITY.md](COMPATIBILITY.md).

## Data and checks

Ten `synthetic-onboarding-cases` v1 cases span starter, busy, ambiguous and boundary profiles. Busy contains 18 prior turns. Imported conversation history is explicitly human-authored synthetic data, with no provider observations, usage or costs. Exact hashes/identities are validated before exclusive initialization. Manifest focus text stays outside model context. [Scenarios](scenarios/README.md) describe review criteria.

```sh
npm run data:check
npm test
npm run package
npm run check:distribution
```

60 offline checks exercise the actual AI SDK/provider adapters, both providers over loopback CLI HTTP, SIGINT/SIGTERM, raw completion/usage, persistence faults, cross-process exclusion, changed state, provenance and all datasets. Fresh locked source-archive installation runs outside the checkout with CLI/data/key preflight and a real busy-session correction. Controlled responses and injected turns prove application boundaries, not live model quality.

Live model judgment needs owner-supplied credentials/model/budget. Authenticated persisted Firedrill runs and licensing remain parked. The repository is publicly viewable; no project license has been selected. [PLAN.md](PLAN.md) records the remaining gates.

Implementation references: [AI SDK v7 structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data), [settings/retry controls](https://ai-sdk.dev/docs/ai-sdk-core/settings), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Explore the [Firedrill examples](https://docs.firedrill.run/guides/examples), [Firedrill](https://firedrill.run/) and [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release.

## Current Firedrill connection — 2026-10-19

The [agent-first integration](firedrill/README.md) pins released CLI/SDK 2.2.2 and invokes the actual conversation CLI with a fresh private case/session per run. Earlier release-unavailability notes are historical. Offline qualification and authenticated/live evidence remain distinct.
