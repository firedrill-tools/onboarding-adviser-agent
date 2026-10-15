import { advise, SessionStore, fields } from './adviser.js';

const args = process.argv.slice(2);
const command = args.shift() ?? 'help';
function option(flag, fallback) {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1];
}
const statePath = option('--state', '.runs/onboarding-session.json');
const store = new SessionStore(statePath);

if (command === 'show') {
  const session = await store.load();
  console.log(JSON.stringify({
    sessionId: session.sessionId,
    revision: session.revision,
    requirements: session.requirements,
    provenance: session.provenance,
    openQuestions: session.openQuestions,
    missing: fields.filter(field => !session.requirements[field]),
    messages: session.messages,
  }, null, 2));
} else if (command === 'say') {
  const textIndex = args.indexOf('--text');
  const userText = textIndex < 0 ? null : args[textIndex + 1];
  const result = await advise({
    store,
    userText,
    provider: option('--provider', 'openai'),
    model: option('--model', process.env.ONBOARDING_MODEL),
  });
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('Usage: npm run advise -- show [--state FILE]');
  console.log('       npm run advise -- say --text "..." --provider openai|anthropic --model MODEL [--state FILE]');
  if (command !== 'help') process.exitCode = 2;
}
