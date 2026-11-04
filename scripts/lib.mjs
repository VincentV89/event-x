import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STACK_NAME = JSON.parse(readFileSync(path.join(ROOT, 'infra', 'cdk.json'), 'utf8')).context.stackName;
export const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

/** Reads stack outputs from infra/outputs.json (written by deploy) or CloudFormation. */
export function stackOutputs() {
  const file = path.join(ROOT, 'infra', 'outputs.json');
  if (existsSync(file)) {
    const all = JSON.parse(readFileSync(file, 'utf8'));
    if (all[STACK_NAME]) return all[STACK_NAME];
  }
  const raw = execFileSync('aws', [
    'cloudformation', 'describe-stacks', '--stack-name', STACK_NAME, '--region', REGION,
    '--query', 'Stacks[0].Outputs', '--output', 'json',
  ]).toString();
  return Object.fromEntries(JSON.parse(raw).map((o) => [o.OutputKey, o.OutputValue]));
}
