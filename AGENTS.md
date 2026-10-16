# Working rules

Keep the actual AI SDK generateText/Output.object conversation path and both configured providers. Require raw native completion before accepting structured updates; do not treat parseable partial JSON as a completed turn. Public fetch injection is the provider seam, with one request/no retries, bounded output/response, cancellation and retained original usage. No fake model result, guessed usage/billing, global dispatcher patch or silently assumed model.

Preserve correction, retraction, untouched fields and user provenance. Duplicate updates and exact-phrase boundary errors fail. Phrase occurrence does not prove interpretation; never turn assistant suggestions into confirmed user requirements. Complete fields indicate plan readiness, never permission for an external action. Keep every dataset's human-authored prior conversation distinct from actual provider execution evidence.

Use SessionStore's owner lock for all writes, hold ownership across the turn, validate history/schema and compare exact source bytes before atomic private publication. Do not take over by lock age or erase a replacement owner. A hard-killed owner requires inspection. Recording/publication failures must retain state commit truth; no blind retry after an uncertain or committed save. Inputs/runs are private and independent sessions must remain isolated.

Use synthetic data only. Regenerate and check all ten cases, preserve manifest focus outside model context, and initialize exclusive copies. Run locked tests and fresh archive verification after relevant changes. Use the new qualified Firedrill release only; live model quality, licensing/publication and released integration remain external gates in PLAN.md.
