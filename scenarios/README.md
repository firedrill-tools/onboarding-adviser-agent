# Onboarding conversation scenarios

Use a separate `--state` file for each scenario. The file persists the session ID, confirmed requirements, the supporting user phrase for each field, open questions and conversation history.

1. **Ordinary intake:** “We are Harbor Labs in the US with 12 teammates. We need to onboard support.” The adviser should retain these details and ask for a timeline.
2. **Correction:** After the first turn, say “Correction: the region is Canada, not US. We want to launch in November.” The saved region should be Canada while the organization and goal remain intact.
3. **Retraction:** Say “Remove November; the launch date is undecided.” The timeline should become null and `readyForPlan` should stay false.
4. **Missing answers:** Give only a vague goal. The adviser should ask for information rather than manufacture a region, team size or date.
5. **Provider failure:** With a missing or invalid key, the command should fail without appending a user or assistant message to the session.

The offline suite uses scripted turn outputs to verify state transitions and failure behavior. It does not prove model conversation quality. A provider key and measured live turns are required for that evidence.
