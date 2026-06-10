import { defineConfig } from 'vitest/config';

import { ciReporterConfig } from '../../scripts/vitest-ci-reporters';

export default defineConfig({
  test: {
    ...ciReporterConfig(),
  },
});
