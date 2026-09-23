#!/usr/bin/env node
/**
 * Thin wrapper so `npm run verify:planner` runs through Vitest
 * (plain Node cannot resolve the Vite project's extensionless imports).
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'vitest',
    'run',
    'src/planner/__tests__/verifyPlanner.test.js',
    '--reporter=verbose'
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096'
    },
    shell: process.platform === 'win32'
  }
)

process.exit(result.status ?? 1)
