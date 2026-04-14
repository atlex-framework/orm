import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const ormRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: ormRoot,
  test: {
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
  },
})
