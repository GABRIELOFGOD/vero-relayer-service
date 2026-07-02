# Database Connection Pooling

## Overview

The vero-relayer-service uses PostgreSQL connection pooling via the `pg` package's `Pool` class to efficiently manage database connections and handle concurrent requests. This implementation significantly reduces connection overhead during traffic bursts and ensures optimal resource utilization.

## Architecture

### Singleton Pattern

The database pool is implemented as a singleton in `src/db/client.js` and `src/db/client.ts`, ensuring that all services share the same connection pool instance across the application.

```javascript
const { pool } = require('./src/db/client');
```

### Connection Lifecycle

1. **Initialization**: Pool is created on application startup with configured min/max connections
2. **Acquisition**: When a query is needed, a connection is acquired from the pool
3. **Execution**: Query executes on the acquired connection
4. **Release**: Connection is returned to the pool for reuse
5. **Cleanup**: Idle connections are closed after timeout period
6. **Shutdown**: All connections are gracefully closed on application termination

## Configuration

### Environment Variables

Configure the connection pool using these environment variables:

| Variable | Description | Default | Recommended |
|----------|-------------|---------|-------------|
| `DATABASE_URL` | Full PostgreSQL connection string | - | Required (takes precedence) |
| `PGHOST` | Database host | - | localhost |
| `PGPORT` | Database port | 5432 | 5432 |
| `PGUSER` | Database user | - | vero_relayer |
| `PGPASSWORD` | Database password | - | Strong password |
| `PGDATABASE` | Database name | - | vero_relayer |
| `DB_POOL_MIN` | Minimum pool connections | 2 | 2-5 |
| `DB_POOL_MAX` | Maximum pool connections | 20 | 10-50 |
| `DB_POOL_IDLE_TIMEOUT` | Idle timeout (ms) | 30000 | 30000 |
| `DB_POOL_CONNECTION_TIMEOUT` | Connection timeout (ms) | 5000 | 5000 |

### Example Configuration

```bash
# Using DATABASE_URL (recommended for production)
DATABASE_URL=postgresql://vero_relayer:password@db.example.com:5432/vero_relayer

# Or using individual parameters (useful for development)
PGHOST=localhost
PGPORT=5432
PGUSER=vero_relayer
PGPASSWORD=your-secure-password
PGDATABASE=vero_relayer

# Pool configuration
DB_POOL_MIN=2
DB_POOL_MAX=20
DB_POOL_IDLE_TIMEOUT=30000
DB_POOL_CONNECTION_TIMEOUT=5000
```

## Usage Patterns

### Basic Query Execution

```javascript
const { pool } = require('./src/db/client');

async function getUserData(userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0];
}
```

### Transaction with Explicit Client

```javascript
const { pool } = require('./src/db/client');

async function transferFunds(fromAccount, toAccount, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
      [amount, fromAccount]
    );
    
    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [amount, toAccount]
    );
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release(); // Always release in finally block
  }
}
```

### Advisory Lock Pattern (Nonce Manager)

```javascript
const { pool } = require('./src/db/client');

async function withAdvisoryLock(lockKey, callback) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    return await callback(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    client.release();
  }
}
```

## Performance Optimization

### Benefits

1. **Connection Reuse**: Eliminates overhead of creating new connections for each request
2. **Concurrent Handling**: Multiple requests share the pool, enabling efficient parallelism
3. **Resource Management**: Automatic cleanup of idle connections prevents resource leaks
4. **Burst Resilience**: Queues requests when pool is saturated instead of failing
5. **Fail-Fast**: Connection timeout prevents hanging on unreachable database

### Monitoring

The pool emits lifecycle events that are logged for observability:

- `connect`: New connection added to pool
- `acquire`: Connection checked out from pool
- `remove`: Connection removed from pool
- `error`: Error on idle connection

### Health Checks

The service exposes pool health and metrics via the `/health` endpoint:

```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "database": {
    "healthy": true,
    "latencyMs": 12,
    "pool": {
      "totalConnections": 5,
      "idleConnections": 3,
      "waitingClients": 0,
      "maxConnections": 20,
      "minConnections": 2,
      "totalErrors": 0
    }
  }
}
```

### Programmatic Metrics

```javascript
const { getPoolMetrics } = require('./src/db/client');

const metrics = getPoolMetrics();
console.log(`Active connections: ${metrics.totalConnections - metrics.idleConnections}`);
console.log(`Pool utilization: ${(metrics.totalConnections / metrics.maxConnections * 100).toFixed(2)}%`);
```

## Benchmarking

Run the included benchmark suite to verify pool performance:

```bash
node benchmarks/pool-performance.js
```

The benchmark tests:

1. **Connection Reuse Efficiency**: Measures how effectively connections are reused
2. **Concurrent Burst Performance**: Tests throughput under various concurrency levels
3. **Pool Saturation Handling**: Verifies behavior when requests exceed pool capacity

### Expected Results

- Connection reuse efficiency: >90%
- Throughput: >100 queries/second at 200 concurrency
- Zero failures under normal load
- Graceful queuing when pool saturated

## Best Practices

### Do's ✅

- Always release connections in `finally` blocks
- Use `pool.query()` for simple queries (automatic release)
- Use `pool.connect()` for transactions or advisory locks
- Configure pool size based on database capacity and workload
- Monitor pool metrics in production
- Set reasonable timeouts to prevent hanging

### Don'ts ❌

- Never forget to call `client.release()`
- Don't create multiple pool instances (use singleton)
- Avoid holding connections longer than necessary
- Don't exceed database `max_connections` setting
- Never commit credentials to version control

## Troubleshooting

### Connection Pool Exhausted

**Symptom**: Requests timeout waiting for connections

**Solution**:
1. Check for connection leaks (unreleased clients)
2. Increase `DB_POOL_MAX` if legitimate load
3. Review slow queries blocking connections
4. Verify database isn't overwhelmed

### High Connection Churn

**Symptom**: Frequent connect/remove events in logs

**Solution**:
1. Increase `DB_POOL_MIN` to maintain warm connections
2. Adjust `DB_POOL_IDLE_TIMEOUT` to keep connections longer
3. Review connection error patterns

### Connection Timeouts

**Symptom**: Errors like "connection timeout" or "ETIMEDOUT"

**Solution**:
1. Verify database is reachable
2. Check network/firewall rules
3. Increase `DB_POOL_CONNECTION_TIMEOUT` if network is slow
4. Review database resource utilization

### Idle Connection Errors

**Symptom**: "Connection terminated unexpectedly" on idle clients

**Solution**:
1. Enable keep-alive (already configured in pool)
2. Check database `tcp_keepalives_*` settings
3. Review firewall idle connection timeouts
4. Decrease `DB_POOL_IDLE_TIMEOUT`

## Security

### Credentials Management

- ✅ Credentials loaded from environment variables only
- ✅ Never hardcoded in source code
- ✅ `.env` excluded from version control via `.gitignore`
- ✅ TLS/SSL supported via connection string parameters

### Example Secure Connection String

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require&sslrootcert=/path/to/ca.crt
```

## References

- [node-postgres Pool Documentation](https://node-postgres.com/features/pooling)
- [PostgreSQL Connection Management](https://www.postgresql.org/docs/current/runtime-config-connection.html)
- [Advisory Locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
