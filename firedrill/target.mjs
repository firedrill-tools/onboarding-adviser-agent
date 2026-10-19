import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { commandMain, invokeCLI, privateDirectory } from './adapter-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cases = new Set(['starter', 'correction']);

export async function runApplication(input, parameters, signal) {
  if (Object.keys(input).some(key => !['caseId', 'provider'].includes(key)) ||
      !cases.has(input.caseId) || !['openai', 'anthropic'].includes(input.provider)) {
    throw new Error('Select a reviewed onboarding case and explicit openai/anthropic provider.');
  }
  const directory = await privateDirectory(root);
  const argv = [process.execPath, 'src/cli.js', 'say', '--case', input.caseId,
    '--provider', input.provider, '--state', join(directory, 'session.json'), '--output-root', join(directory, 'evidence')];
  if (parameters.model) argv.push('--model', parameters.model);
  return await invokeCLI(argv, { cwd: root, signal });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await commandMain(runApplication);
}
