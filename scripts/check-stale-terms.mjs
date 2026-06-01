#!/usr/bin/env node
/**
 * Anti-term-drift — scans code and docs for the legacy terms forbidden by CLAUDE.md §4.1.
 *
 * Any match exits 1; CI runs `pnpm spec:terms` to enforce.
 *
 * This is currently a placeholder implementation covering the most critical legacy words; can be extended later.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// Explicitly forbidden by CLAUDE.md §4.1
const FORBIDDEN_TERMS = [
  { term: '调用记录' },
  { term: 'Provider', proseOnly: true }, // "Provider" is only forbidden in Chinese user-facing strings; "provider" in code is still allowed
  { term: 'Project administrator' },
  { term: 'Project Administrator' },
  { term: 'roles.developer' },
  { term: 'countProjectDevelopers' },
  { term: 'role-dev' },
  { term: '操作员' },
  { term: '审核员' },
  { term: '观察员' },
  // 2026-05-17 orchestration stack switched from Temporal to DBOS + BullMQ
  { term: '@temporalio' },
  { term: 'Temporal Workflow' },
  { term: 'TEMPORAL_ADDRESS' },
  { term: 'TEMPORAL_NAMESPACE' },
  { term: '@proofhound/temporal-shared' },
  { term: 'ph_temporal_mirror' },
];

// Only scan these extensions
const EXTS = new Set(['.md', '.mdx', '.tsx', '.ts', '.json', '.yml', '.yaml']);
const CODE_EXTS = new Set(['.tsx', '.ts']);

// Skip these directories
const EXCLUDE_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', '.git', 'coverage']);
const EXCLUDE_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'scripts/check-stale-terms.mjs',
  'pnpm-lock.yaml',
]);

// User-facing vs in-code distinction: scan everything by default, but allow whitelisting via *.code-allow.json.
// For simplicity: scan all first, then add a whitelist file when false positives appear.
let violations = 0;

/**
 * @param {string} dir
 */
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
    } else {
      const ext = entry.slice(entry.lastIndexOf('.'));
      if (!EXTS.has(ext)) continue;
      const content = readFileSync(p, 'utf8');
      const rel = relative(ROOT, p);
      // Skip the SPECs themselves (00-32 are the source of truth, possibly mentioning legacy terms in historical change notes)
      if (rel.startsWith('docs/specs/')) continue;
      // Skip internal superpowers planning docs — working artifacts (not user-facing product strings) that
      // legitimately quote framework API names like `overrideProvider` / `llmConsumerProviders` and code
      // identifiers like *Provider verbatim.
      if (rel.startsWith('docs/superpowers/')) continue;
      // Skip the constraint description files and this script itself (they need to list the forbidden words verbatim)
      if (EXCLUDE_FILES.has(rel)) continue;

      for (const { term, proseOnly } of FORBIDDEN_TERMS) {
        if (proseOnly && CODE_EXTS.has(ext)) continue;
        if (content.includes(term)) {
          console.error(`[stale-term] ${rel} contains forbidden term: "${term}"`);
          violations++;
        }
      }
    }
  }
}

walk(ROOT);

if (violations > 0) {
  console.error(`\n${violations} stale term(s) found. See CLAUDE.md §4.1.`);
  process.exit(1);
}

console.log('No stale terms found.');
