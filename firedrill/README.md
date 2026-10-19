# Firedrill agent-first integration

The separate optional npm toolchain exact-pins released CLI and TypeScript SDK **2.2.2** (verified October 19, 2026). Node 22+ is required. Application/provider versions remain in the root lockfile.

## Prepare and authorize

From the repository root:

```sh
npm ci
npm ci --prefix firedrill --ignore-scripts --no-audit --no-fund
npm test --prefix firedrill
firedrill_cli=firedrill/node_modules/@firedrill-run/cli/bin/firedrill.mjs
node "$firedrill_cli" validate firedrill/scenario.json --json --non-interactive
```

Offline validation allocates no batch. Initialize scope with `node "$firedrill_cli" init` in a human terminal. Automation uses `FIREDRILL_TOKEN`, `FIREDRILL_PROJECT_ID` and `FIREDRILL_ENVIRONMENT_ID` from its secret store. Keep the application's OpenAI/Anthropic key and enabled `ONBOARDING_MODEL` separate. Alternatively select the enabled model through `configuration.parameters.model` in a reviewed recipe. Do not put credentials in recipes or source.

## Run the actual conversation

With an authorized provider budget:

```sh
node firedrill/simulate.mjs --preview
node "$firedrill_cli" simulate firedrill/scenario.json --scenario starter --json --non-interactive
```

The adapter invokes the normal `src/cli.js say --case` path and actual Vercel AI SDK. The full recipe contains starter and correction situations, one repetition and concurrency one. Each invocation initializes a fresh private session from its hash-bound human-authored history, then executes its actual user turn. The reviewed input explicitly chooses the provider; the supplied recipe uses OpenAI, and Anthropic requires its corresponding enabled model/key. The adapter does not generate an answer or infer readiness from a scenario expectation.

Private `.runs/firedrill/attempt-*` directories retain session state and evidence after success, cancellation or failure. A new invocation never overwrites or resets an earlier session. Reset does not remove provider retention/billing. Per-turn request limits and deadlines remain the application's existing bounds, not billing guarantees. There are no production SaaS actions or synthetic Firedrill Tool bindings.

The command envelope uses `2026-10-17-target-invocation.1`, ID-only scenario context and explicit task input. Controller checks/rubrics, unexpected configuration and unsupported Tool connections are rejected. Firedrill/CI operator credentials are removed before application dispatch. Actual JSON output is returned; partial output and stderr remain failed execution evidence on nonzero status.

`node firedrill/simulate.mjs` uses the SDK to run the same complete recipe. Execution completion, output quality, optional assessment and gate are distinct; this recipe requests no grading or gate.

## MCP, recovery and CI

Use remote OAuth MCP **https://mcp.firedrill.run/mcp** with the [host-specific instructions](https://docs.firedrill.run/guides/coding-agents); no local MCP package is required. MCP authorization is separate from CLI/SDK sign-in. MCP prepares/queues/inspects; the local CLI/SDK executes. Attach the returned batch with `node firedrill/simulate.mjs --run BATCH_ID`.

Preserve the operation ID and private journal after uncertainty. Use `--resume OPERATION_ID` to recover it or `--result BATCH_ID` for a retained read. Do not create another simulation to recover an acknowledgement. Runner exit codes preserve execution errors, pending assessment/work and optional gates.

Ordinary CI and the fresh source distribution gate run offline integration checks. Use the official [CI generator](https://docs.firedrill.run/guides/ci) only with actual scope, protected secrets and selected model budgets. Authenticated persisted happy/negative runs, live provider quality/cost, publication and licensing remain separate gates.

References: [SDK](https://docs.firedrill.run/sdk/typescript), [command targets](https://docs.firedrill.run/guides/callbacks), [CLI](https://docs.firedrill.run/cli/overview), [operator MCP](https://docs.firedrill.run/guides/control-mcp).

Before application dispatch, each private workspace saves the validated outer run/attempt/scenario IDs in `invocation.json`. This maps interrupted runs to local state; it is separate from the SDK recovery journal and grants no application authority.
