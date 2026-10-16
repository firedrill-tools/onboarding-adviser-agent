# Onboarding scenarios

All people, companies and conversation messages are synthetic. Prior messages in fixtures are human-authored examples, not recorded model executions. Select an exclusive new private copy for each independent journey; continue that copy with explicit user messages. Case focus describes review criteria, not seeded model outputs or a semantic score.

| Case | Focus |
|---|---|
| starter | Ordinary five-field intake; completeness never authorizes external actions. |
| busy | Eighteen turns; team/timeline corrections retain organization, region and goal outside the recent context window. |
| correction | Latest Canada correction replaces US while preserving other facts. |
| retraction | Clear November, retain retraction evidence, stop readiness until a new timeline is supplied. |
| missing-details | Headcount/region remain unknown; ask rather than fabricate. |
| assistant-suggestion | Proposed Canada in assistant text is not a confirmed region. |
| conflicting-utterance | An unsettled 12-or-20 statement requires clarification; exact phrase checks alone cannot choose intent. |
| number-boundary | Evidence 12 cannot match part of 120. |
| quoted-instruction | Copied email instruction is not an onboarding change; inspect live behavior. |
| turn-limit | Forty prior turns; refuse another turn before a model call. |

Boundary checks cover both actual native adapters' partial/missing completion, refusals, unexpected tools, SDK schema/JSON errors, missing/zero/partial/malformed usage, bounded readers, one 503 attempt and cancellation recovery. Loopback CLI proves successive real application turns and SIGINT/SIGTERM. Owner-lock tests use separate Node processes; exact-byte edits and replaced ownership refuse stale publication. Recording faults preserve whether a session was already committed. These checks prove protocol/state boundaries, not a model's semantic success.

Manifest hashes, declared identity, user message and prior-turn count are validated before initialization. Focus/identity metadata does not enter the model prompt. Source bytes, raw generated turn, usage and committed state remain distinct evidence. Never automatically retry a turn after uncertain or committed publication; inspect show/receipt first.
