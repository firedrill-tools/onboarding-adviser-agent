# Onboarding adviser requirement audit

## Completed standalone work

1. **Session integrity:** strict bounded schema/history/provenance, immutable loaded snapshot, exact phrase boundaries and duplicate update rejection. One private owner lock covers model generation and publication across local Node processes. Exact source bytes/revision/identity checks and private fsynced atomic writes preserve unrelated facts; failed/cancelled turns do not publish. Replaced locks are retained, no age takeover.
2. **Native providers:** actual AI SDK generateText/Output.object/OpenAI Responses/Anthropic Messages through public fetch injection. Raw completion required before SDK parsing, one attempt/step, 2048 output tokens, 1-MiB inputs/decoded responses and 120-second maximum deadline. Explicit model/key/endpoint, original raw/normalized usage separately, owned cancellation/readers and error evidence.
3. **Data:** ten deterministic hash-bound synthetic-onboarding-cases v1 cases/four profiles; coherent 18-turn busy history and 40-turn limit. Imported messages are synthetic_human_authored with no provider usage. Private exclusive copies; focus metadata stays outside model input.
4. **Operations:** private per-turn receipts and separate state-commit evidence; recording failure refuses publication unless state already committed, which remains explicit. Actual CLI HTTP for both providers/successive turns/faults/signals; fresh lock-bound source archive outside checkout, CI/catalog qualification.

## Reproduced regressions

- Both native providers accepted schema-valid partial and absent-completion turns through the original generateTurn. Raw provider completion now gates the update; original response/usage remains inspectable on rejection.
- Two actual synchronized SessionStore writers both reported revision 1 and lost one user turn. Owner exclusion begins before generation; a second process gets SESSION_BUSY without a model call.
- Duplicate field updates silently selected the last value. Substring evidence could match US in BUSINESS or 12 in 120. Strict uniqueness and exact whole-word/number phrase checks now reject these cases, without pretending to prove intent.
- The original engine declaration allowed Node 20 while pinned provider packages require Node 22; metadata now matches the exercised runtime contract.

## Parked gates

Live OpenAI/Anthropic interpretation of corrections, ambiguity, paraphrases and quoted instructions needs owner-supplied model/key/budget and human review. Test fixtures do not establish model quality, retention or billing.

New official Firedrill release/contract, persisted ordinary and negative/recovery cases, exact-release CI; publication and license ownership remain external gates. Keep the repository private and continue independent portfolio work.
