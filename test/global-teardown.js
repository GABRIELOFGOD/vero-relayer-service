'use strict';

const { after } = require('node:test');

// Several modules lazily open a real connection to a shared external service
// (Postgres pool, Redis clients, BullMQ queue) the first time they're used,
// and cache it as a module-level singleton. Against real, reachable services
// (as in CI, unlike local dev where connections just fail fast) an unclosed
// connection keeps that test file's subprocess alive indefinitely, hanging
// the whole suite — this has bitten webhook.test.js, event-worker.test.js,
// and stellar-fee.test.js so far, each via a different call path into the
// same handful of singletons. Rather than relying on every test file to
// remember its own teardown, close everything known to be lazily opened
// once, after each file's tests finish. Closing a resource that was never
// touched is always a safe no-op.
after(async () => {
  const closers = [
    () => require('../src/db/client').shutdown(),
    () => require('../src/middleware/idempotency').closeRedisClient(),
    () => require('../src/middleware/rateLimit').closeRedisClient(),
    () => require('../src/queue/event-queue').closeEventQueue(),
  ];

  await Promise.all(closers.map(close => Promise.resolve().then(close).catch(() => {})));
});
