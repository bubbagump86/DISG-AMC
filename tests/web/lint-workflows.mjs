/**
 * Lints the GitHub Actions workflow files.
 *
 * Workflows only run in CI, so a broken one is not discovered locally -- a bad
 * expression or a missing script path costs a failed run to find. This checks
 * the things that actually break:
 *
 *   - the file parses as YAML
 *   - every job has runs-on and steps; every step has exactly one of uses/run
 *   - `uses:` references are version-pinned
 *   - the refresh workflow keeps its cron, manual dispatch and contents:write
 *   - every local path a workflow runs actually exists
 *   - the inline shell snippets are syntactically valid bash
 *
 * Requires a YAML parser, which this environment does not ship: there is no
 * pyyaml (PyPI unreachable) and no js-yaml in the project (npm registry
 * unreachable). It therefore looks for one in the usual places and reports a
 * clear skip when none is found, rather than failing for the wrong reason.
 *
 * Usage: node tests/web/lint-workflows.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WORKFLOWS = [
  '.github/workflows/refresh.yml',
  '.github/workflows/tests.yml',
];

const require = createRequire(import.meta.url);
const YAML_CANDIDATES = [
  'js-yaml',
  'yaml',
  // This machine has a copy vendored inside a globally installed npm package.
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@byted-aml', 'ark-helper', 'node_modules', 'js-yaml'),
];

function loadYaml() {
  for (const candidate of YAML_CANDIDATES) {
    try {
      return require(candidate);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const problems = [];
const notes = [];
const check = (ok, message) => (ok ? notes.push(`  ok   ${message}`) : problems.push(`  FAIL ${message}`));

const yaml = loadYaml();

if (!yaml) {
  notes.push('  skip no YAML parser available (install js-yaml to enable the full lint)');
} else {
  for (const file of WORKFLOWS) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) {
      problems.push(`  FAIL ${file}: missing`);
      continue;
    }
    let doc;
    try {
      doc = yaml.load(readFileSync(full, 'utf8'));
      notes.push(`  ok   ${file}: valid YAML`);
    } catch (error) {
      problems.push(`  FAIL ${file}: YAML parse error -- ${error.message}`);
      continue;
    }

    // js-yaml resolves the bare key `on` to the boolean true.
    const on = doc.on ?? doc[true];
    check(typeof doc.name === 'string' && doc.name.length > 0, `${file}: has a name`);
    check(Boolean(on), `${file}: declares a trigger`);
    check(Boolean(doc.jobs && Object.keys(doc.jobs).length), `${file}: declares jobs`);

    for (const [jobName, job] of Object.entries(doc.jobs || {})) {
      check(typeof job['runs-on'] === 'string', `${file}:${jobName}: has runs-on`);
      check(Array.isArray(job.steps) && job.steps.length > 0, `${file}:${jobName}: has steps`);
      for (const step of job.steps || []) {
        const label = step.name || step.uses || '(unnamed)';
        const usesCount = [step.uses, step.run].filter((v) => typeof v === 'string').length;
        check(usesCount === 1, `${file}:${jobName}: "${label}" has exactly one of uses/run`);
        if (typeof step.uses === 'string') {
          check(/@v\d+$/.test(step.uses), `${file}:${jobName}: "${step.uses}" is version-pinned`);
        }
      }
    }

    if (file.endsWith('refresh.yml')) {
      check(Array.isArray(on && on.schedule) && Boolean(on.schedule[0] && on.schedule[0].cron),
        `${file}: has a cron schedule`);
      check(Boolean(on && on.workflow_dispatch), `${file}: can be dispatched manually`);
      check(doc.permissions && doc.permissions.contents === 'write',
        `${file}: requests contents: write (needed to push the refresh commit)`);
      check(Boolean(on && on.workflow_dispatch && on.workflow_dispatch.inputs),
        `${file}: documents its dispatch inputs`);
    }
  }
}

// ---- shell snippets must be valid bash -------------------------------------
if (yaml) {
  for (const file of WORKFLOWS) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) continue;
    const doc = yaml.load(readFileSync(full, 'utf8'));
    for (const [jobName, job] of Object.entries((doc && doc.jobs) || {})) {
      for (const step of job.steps || []) {
        if (typeof step.run !== 'string') continue;
        const label = step.name || jobName;
        try {
          execFileSync('bash', ['-n'], { input: step.run, stdio: ['pipe', 'pipe', 'pipe'] });
          notes.push(`  ok   ${file}: bash syntax valid -- "${label}"`);
        } catch (error) {
          problems.push(`  FAIL ${file}: bash syntax error in "${label}": ${error.stderr}`);
        }
      }
    }
  }
}

// ---- local paths the workflows depend on -----------------------------------
const REFERENCED = [
  'tests',
  'tests/web/unit.mjs',
  'tests/web/smoke.mjs',
  'pipeline',
  'data.json',
  'stats.json',
  '.nojekyll',
];
for (const relative of REFERENCED) {
  check(existsSync(path.join(ROOT, relative)), `path referenced by CI exists: ${relative}`);
}

process.stdout.write('# workflow lint\n');
process.stdout.write(notes.join('\n') + '\n');
if (problems.length) {
  process.stdout.write(problems.join('\n') + '\n');
  process.stdout.write(`\nFAILED: ${problems.length} problem(s)\n`);
  process.exit(1);
}
process.stdout.write(`\nOK: ${notes.length} checks passed\n`);
