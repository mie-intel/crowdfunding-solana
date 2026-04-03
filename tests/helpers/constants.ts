/** Seconds until a short-lived campaign deadline expires in tests. */
export const SHORT_DEADLINE_SEC = 2;

/**
 * Milliseconds to wait after a short deadline before asserting post-expiry behaviour.
 * Adds a buffer to absorb the ~1s lag between JS wall time and validator clock.
 */
export const WAIT_MS = 5_000;
