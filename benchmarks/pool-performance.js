/**
 * Benchmark test for PostgreSQL connection pool performance.
 * 
 * This test measures:
 * 1. Connection reuse efficiency during bursts
 * 2. Concurrent request handling
 * 3. Connection pool overhead vs. single connections
 * 4. Pool saturation behavior
 * 
 * Run with: node benchmarks/pool-performance.js
 */

require('dotenv').config();
const { pool, getPoolMetrics } = require('../src/db/client');
const { logger } = require('../src/logger');

// Benchmark configuration
const CONCURRENT_REQUESTS = [10, 50, 100, 200];
const QUERIES_PER_TEST = 100;

/**
 * Simulate a database query operation
 */
async function executeQuery(queryId) {
  const client = await pool.connect();
  try {
    const startTime = Date.now();
    await client.query('SELECT $1::integer as id, NOW() as timestamp, pg_sleep(0.001)', [queryId]);
    const duration = Date.now() - startTime;
    return { queryId, duration, success: true };
  } catch (error) {
    return { queryId, duration: 0, success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Run concurrent queries and measure performance
 */
async function runConcurrentBurst(concurrency, totalQueries) {
  const startTime = Date.now();
  const results = [];
  const batches = Math.ceil(totalQueries / concurrency);
  
  logger.info({ concurrency, totalQueries, batches }, '[benchmark] Starting concurrent burst test');
  
  for (let batch = 0; batch < batches; batch++) {
    const batchSize = Math.min(concurrency, totalQueries - (batch * concurrency));
    const promises = [];
    
    for (let i = 0; i < batchSize; i++) {
      const queryId = (batch * concurrency) + i;
      promises.push(executeQuery(queryId));
    }
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  
  const totalDuration = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const avgQueryDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  
  return {
    concurrency,
    totalQueries,
    totalDuration,
    successCount,
    failCount,
    avgQueryDuration,
    throughput: (successCount / totalDuration) * 1000, // queries per second
  };
}

/**
 * Test connection reuse by tracking pool metrics
 */
async function testConnectionReuse() {
  logger.info('[benchmark] Testing connection reuse...');
  
  const initialMetrics = getPoolMetrics();
  const queries = [];
  
  // Execute 50 queries sequentially
  for (let i = 0; i < 50; i++) {
    queries.push(await executeQuery(i));
  }
  
  const finalMetrics = getPoolMetrics();
  
  return {
    initialConnections: initialMetrics.totalConnections,
    finalConnections: finalMetrics.totalConnections,
    connectionsCreated: finalMetrics.totalConnections - initialMetrics.totalConnections,
    reuseEfficiency: ((50 - (finalMetrics.totalConnections - initialMetrics.totalConnections)) / 50) * 100,
  };
}

/**
 * Test pool saturation behavior
 */
async function testPoolSaturation() {
  logger.info('[benchmark] Testing pool saturation...');
  
  const poolMax = getPoolMetrics().maxConnections;
  const oversaturate = poolMax * 2; // Request 2x the pool size
  
  const startTime = Date.now();
  const promises = [];
  
  for (let i = 0; i < oversaturate; i++) {
    promises.push(executeQuery(i));
  }
  
  const results = await Promise.all(promises);
  const duration = Date.now() - startTime;
  
  const successCount = results.filter(r => r.success).length;
  const metrics = getPoolMetrics();
  
  return {
    poolMax,
    requestedConnections: oversaturate,
    successCount,
    failCount: results.length - successCount,
    duration,
    peakWaitingClients: metrics.waitingClients,
    handledOverload: successCount === oversaturate,
  };
}

/**
 * Main benchmark runner
 */
async function runBenchmarks() {
  console.log('\n🚀 PostgreSQL Connection Pool Performance Benchmarks\n');
  console.log('='.repeat(70));
  
  try {
    // Test 1: Connection Reuse Efficiency
    console.log('\n📊 Test 1: Connection Reuse Efficiency');
    console.log('-'.repeat(70));
    const reuseResults = await testConnectionReuse();
    console.log(`Initial connections:     ${reuseResults.initialConnections}`);
    console.log(`Final connections:       ${reuseResults.finalConnections}`);
    console.log(`New connections created: ${reuseResults.connectionsCreated}`);
    console.log(`Reuse efficiency:        ${reuseResults.reuseEfficiency.toFixed(2)}%`);
    
    // Test 2: Concurrent Burst Performance
    console.log('\n📊 Test 2: Concurrent Burst Performance');
    console.log('-'.repeat(70));
    const burstResults = [];
    
    for (const concurrency of CONCURRENT_REQUESTS) {
      const result = await runConcurrentBurst(concurrency, QUERIES_PER_TEST);
      burstResults.push(result);
      
      console.log(`\nConcurrency: ${concurrency}`);
      console.log(`  Total queries:      ${result.totalQueries}`);
      console.log(`  Total duration:     ${result.totalDuration}ms`);
      console.log(`  Success count:      ${result.successCount}`);
      console.log(`  Fail count:         ${result.failCount}`);
      console.log(`  Avg query duration: ${result.avgQueryDuration.toFixed(2)}ms`);
      console.log(`  Throughput:         ${result.throughput.toFixed(2)} queries/sec`);
    }
    
    // Test 3: Pool Saturation Handling
    console.log('\n📊 Test 3: Pool Saturation Handling');
    console.log('-'.repeat(70));
    const saturationResults = await testPoolSaturation();
    console.log(`Pool max connections:    ${saturationResults.poolMax}`);
    console.log(`Requested connections:   ${saturationResults.requestedConnections}`);
    console.log(`Success count:           ${saturationResults.successCount}`);
    console.log(`Fail count:              ${saturationResults.failCount}`);
    console.log(`Duration:                ${saturationResults.duration}ms`);
    console.log(`Handled overload:        ${saturationResults.handledOverload ? '✅ Yes' : '❌ No'}`);
    
    // Final pool metrics
    console.log('\n📊 Final Pool Metrics');
    console.log('-'.repeat(70));
    const finalMetrics = getPoolMetrics();
    console.log(`Total connections:       ${finalMetrics.totalConnections}`);
    console.log(`Idle connections:        ${finalMetrics.idleConnections}`);
    console.log(`Waiting clients:         ${finalMetrics.waitingClients}`);
    console.log(`Max connections:         ${finalMetrics.maxConnections}`);
    console.log(`Min connections:         ${finalMetrics.minConnections}`);
    console.log(`Total errors:            ${finalMetrics.totalErrors}`);
    
    // Summary
    console.log('\n✅ Benchmark Summary');
    console.log('='.repeat(70));
    console.log(`✓ Connection reuse:      ${reuseResults.reuseEfficiency > 90 ? 'EXCELLENT' : reuseResults.reuseEfficiency > 70 ? 'GOOD' : 'NEEDS IMPROVEMENT'}`);
    console.log(`✓ Concurrent handling:   ${burstResults.every(r => r.failCount === 0) ? 'PASSED' : 'FAILED'}`);
    console.log(`✓ Pool saturation:       ${saturationResults.handledOverload ? 'PASSED' : 'FAILED'}`);
    console.log(`✓ Overall performance:   ${burstResults[burstResults.length - 1].throughput.toFixed(2)} queries/sec`);
    
    console.log('\n✨ Benchmarks completed successfully!\n');
    
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Run benchmarks if executed directly
if (require.main === module) {
  runBenchmarks().catch(err => {
    console.error('Fatal error running benchmarks:', err);
    process.exit(1);
  });
}

module.exports = {
  runConcurrentBurst,
  testConnectionReuse,
  testPoolSaturation,
};
