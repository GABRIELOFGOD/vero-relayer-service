const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const { processEventJob } = require('../src/workers/event-worker');

function retryJob(data, overrides = {}) {
  return {
    id: overrides.id || 'retry-original-job-1-1',
    data,
    attemptsMade: overrides.attemptsMade || 0,
    opts: {
      attempts: overrides.attempts || 5
    }
  };
}

function buildRetryResumePayload(prNumber = 42) {
  return {
    eventType: 'github.pull_request.merged',
    receivedAt: new Date().toISOString(),
    requestId: null,
    source: 'github',
    idempotencyKey: `retry-key-${prNumber}`,
    payload: {
      action: 'closed',
      pull_request: {
        number: prNumber,
        merged: true,
        labels: [{ name: 'wave-contribution' }]
      },
      repository: null
    }
  };
}

test('retry-resumed job is accepted by processEventJob and broadcast succeeds', async () => {
  const calls = [];
  const payload = buildRetryResumePayload(42);
  const job = retryJob(payload, { id: 'retry-original-job-1-1' });

  const result = await processEventJob(job, {
    registerTaskOnChain: async prNumber => {
      calls.push(prNumber);
    }
  });

  assert.deepEqual(calls, [42]);
  assert.deepEqual(result, { pr: 42 });
});

test('retry-resumed job with different PR number is processed correctly', async () => {
  const calls = [];
  const payload = buildRetryResumePayload(99);
  const job = retryJob(payload, { id: 'retry-original-job-2-3' });

  const result = await processEventJob(job, {
    registerTaskOnChain: async prNumber => {
      calls.push(prNumber);
    }
  });

  assert.deepEqual(calls, [99]);
  assert.deepEqual(result, { pr: 99 });
});

test('retry-resumed job is rejected when eventType is retry.resume (old broken payload)', async () => {
  const calls = [];
  const brokenPayload = {
    eventType: 'retry.resume',
    originalJobId: 'original-job-1',
    retryId: 1
  };
  const job = retryJob(brokenPayload, { id: 'retry-original-job-1-1' });

  await assert.rejects(
    () => processEventJob(job, {
      registerTaskOnChain: async prNumber => {
        calls.push(prNumber);
      }
    }),
    /Unsupported event type: retry\.resume/
  );
  assert.deepEqual(calls, []);
});

test('retry-resumed job without pull request number is rejected as unrecoverable', async () => {
  const calls = [];
  const payload = {
    eventType: 'github.pull_request.merged',
    receivedAt: new Date().toISOString(),
    payload: {
      action: 'closed',
      pull_request: {},
      repository: null
    }
  };
  const job = retryJob(payload, { id: 'retry-original-job-1-1' });

  await assert.rejects(
    () => processEventJob(job, {
      registerTaskOnChain: async prNumber => {
        calls.push(prNumber);
      }
    }),
    /missing pull request number/
  );
  assert.deepEqual(calls, []);
});

test('retry-resumed job records broadcast failure for downstream retry', async () => {
  const payload = buildRetryResumePayload(55);
  const job = retryJob(payload, { id: 'retry-original-job-3-2' });

  const broadcastError = new Error('Stellar transaction failed');
  await assert.rejects(
    () => processEventJob(job, {
      registerTaskOnChain: async () => {
        throw broadcastError;
      }
    }),
    /Stellar transaction failed/
  );
});
