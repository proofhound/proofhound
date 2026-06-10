import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Vitest's built-in github-actions reporter appends an anonymous
// "## Vitest Test Report" block to GITHUB_STEP_SUMMARY for every vitest run,
// so a turbo-wide `pnpm test` floods the job summary with indistinguishable
// reports. ciReporterConfig() keeps that reporter's failure annotations but
// replaces the job summary with one package-labelled stats line per run.

interface TaskLike {
  mode?: string;
  result?: { state?: string };
}

interface TestModuleLike {
  task: TaskLike;
  children: { allTests(): Iterable<{ task: TaskLike }> };
}

class PackageStepSummaryReporter {
  private root = process.cwd();

  onInit(ctx: { config: { root: string } }) {
    this.root = ctx.config.root;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModuleLike>, unhandledErrors: ReadonlyArray<unknown>) {
    const outputPath = process.env.GITHUB_STEP_SUMMARY;
    if (!outputPath || testModules.length === 0) return;

    let packageName = this.root;
    try {
      packageName = JSON.parse(readFileSync(join(this.root, 'package.json'), 'utf8')).name ?? this.root;
    } catch {
      // Fall back to the root path when no package.json is readable.
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const module of testModules) {
      for (const test of module.children.allTests()) {
        if (test.task.mode === 'skip' || test.task.mode === 'todo') {
          skipped += 1;
          continue;
        }
        switch (test.task.result?.state) {
          case 'pass':
            passed += 1;
            break;
          case 'fail':
            failed += 1;
            break;
        }
      }
    }

    const parts: string[] = [];
    if (failed > 0) parts.push(`${failed} failed`);
    parts.push(`${passed} passed`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (unhandledErrors.length > 0) parts.push(`${unhandledErrors.length} unhandled errors`);
    const fileCount = `${testModules.length} ${testModules.length === 1 ? 'file' : 'files'}`;
    const icon = failed > 0 || unhandledErrors.length > 0 ? '❌' : '✅';
    const line = `- ${icon} **${packageName}**: ${parts.join(' · ')} (${fileCount})\n`;

    try {
      // A single appending write keeps concurrent package runs from interleaving.
      writeFileSync(outputPath, line, { flag: 'a' });
    } catch {
      // Never fail a test run over a summary write.
    }
  }
}

export function ciReporterConfig() {
  if (process.env.GITHUB_ACTIONS !== 'true') return {};
  return {
    reporters: ['default', ['github-actions', { jobSummary: { enabled: false } }], new PackageStepSummaryReporter()],
  } as const;
}
