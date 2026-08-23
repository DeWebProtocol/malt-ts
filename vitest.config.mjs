import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        url: 'https://gateway.deweb.world/'
      }
    },
    include: ['test/**/*.test.mjs'],
    restoreMocks: true
  }
})
