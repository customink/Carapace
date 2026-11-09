/**
 * Side-by-side test instance: `npm run test-instance` runs a build next to the real Carapace
 * without touching it. It gets its own userData (so the single-instance lock doesn't stop it),
 * and skips everything that is machine-global and owned by the real instance:
 * Claude Code hooks (+ their port), the Services menu entries, global shortcuts, scheduled
 * prompts, and the daily token store (which is rewritten whole from memory).
 * Session history, presets and other read-modify-write stores stay shared on purpose, so
 * your real sessions can be revived in the test instance.
 */
export const IS_TEST_INSTANCE = process.env.CARAPACE_TEST_INSTANCE === '1'

/** Prefix for window titles so test windows are easy to tell apart */
export const TEST_TITLE_PREFIX = IS_TEST_INSTANCE ? '🧪 ' : ''
