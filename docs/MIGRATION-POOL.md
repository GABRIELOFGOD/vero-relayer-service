# Migration Guide: PostgreSQL Connection Pool

This guide helps you configure and verify the enhanced PostgreSQL connection pool implementation.

## Prerequisites

- PostgreSQL database server running
- Node.js 18+ installed
- Access to database credentials

## Step 1: Update Environment Variables

Add the following database configuration to your `.env` file:

```bash
# Option A: Using DATABASE_URL (Recommended for production)
DATABASE_URL=postgresql://username:password@host:port/database

# Option B: Using individual parameters (Useful for development)
PGHOST=localhost
PGPORT=5432
PGUSER=vero_relayer
PGPASSWORD=your-secure-password
PGDATABASE=vero_relayer

# Connection Pool Configuration (Optional - defaults shown)
DB_POOL_MIN=2
DB_POOL_MAX=20
DB_POOL_IDLE_TIMEOUT=30000
DB_POOL_CONNECTION_TIMEOUT=5000
```

### Choosing Pool Size

| Environment | DB_POOL_MIN | DB_POOL_MAX | Rationale |
|-------------|-------------|-------------|-----------|
| Development | 2 | 10 | Light load, minimize connections |
| Staging | 2 | 20 | Moderate load, testing scenarios |
| Production | 5 | 50 | High load, handle bursts |

**Important**: Ensure `DB_POOL_MAX` does not exceed your PostgreSQL `max_connections` setting (typically 100 by default).

## Step 2: Verify Database Connection

Test the database connection and pool:

```bash
# Start the application
npm start

# In another terminal, check the health endpoint
curl http://localhost:3000/health | jq
```

Expected response:
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "database": {
    "healthy": true,
    "latencyMs": 12,
    "pool": {
      "totalConnections": 2,
      "idleConnections": 2,
      "waitingClients": 0,
      "maxConnections": 20,
      "minConnections": 2,
      "totalErrors": 0
    }
  }
}
```

If you see `"healthy": false`, check:
1. Database is running and accessible
2. Credentials in `.env` are correct
3. Network/firewall allows connection to database
4. Database user has required permissions

## Step 3: Run Benchmarks

Verify pool performance with the benchmark suite:

```bash
npm run benchmark:pool
```

You should see output like:

```
🚀 PostgreSQL Connection Pool Performance Benchmarks
======================================================================

📊 Test 1: Connection Reuse Efficiency
----------------------------------------------------------------------
Initial connections:     2
Final connections:       3
New connections created: 1
Reuse efficiency:        98.00%

📊 Test 2: Concurrent Burst Performance
----------------------------------------------------------------------
Concurrency: 10
  Total queries:      100
  Total duration:     245ms
  Success count:      100
  Fail count:         0
  Avg query duration: 2.45ms
  Throughput:         408.16 queries/sec

Concurrency: 50
  Total queries:      100
  Total duration:     312ms
  Success count:      100
  Fail count:         0
  Avg query duration: 3.12ms
  Throughput:         320.51 queries/sec

...

✅ Benchmark Summary
======================================================================
✓ Connection reuse:      EXCELLENT
✓ Concurrent handling:   PASSED
✓ Pool saturation:       PASSED
✓ Overall performance:   289.02 queries/sec

✨ Benchmarks completed successfully!
```

### Interpreting Results

- **Connection reuse >90%**: Pool is efficiently reusing connections ✅
- **Connection reuse <70%**: Check `DB_POOL_IDLE_TIMEOUT`, may be too aggressive ⚠️
- **Any failed queries**: Investigate database connectivity or pool configuration ❌
- **Throughput <50 q/s**: Check database performance or network latency ⚠️

## Step 4: Monitor in Production

### Application Logs

The pool logs connection lifecycle events:

```json
{"level":"debug","component":"db","msg":"Client acquired from pool","totalConnections":5,"idleConnections":3,"waitingClients":0}
{"level":"info","component":"db","msg":"Pool health check passed","totalConnections":5,"idleConnections":5,"waitingClients":0,"latencyMs":8}
```

### Health Checks

Set up monitoring to periodically check `/health`:

```bash
# Example: Monitor with curl
while true; do
  curl -s http://localhost:3000/health | jq '.database.pool'
  sleep 30
done
```

### Key Metrics to Monitor

| Metric | Alert Threshold | Action |
|--------|----------------|--------|
| `waitingClients > 0` | Sustained for >1 min | Increase `DB_POOL_MAX` |
| `totalConnections == maxConnections` | Sustained for >5 min | Review slow queries, consider scaling |
| `totalErrors > 0` | Any occurrence | Check database health, network |
| `latencyMs > 100` | Consistent | Investigate database performance |
| `healthy: false` | Any occurrence | Page on-call, database is down |

## Step 5: Troubleshooting

### Issue: "Connection timeout" errors

**Symptoms**: Logs show `connection timeout` or clients wait indefinitely

**Solutions**:
```bash
# Increase connection timeout
DB_POOL_CONNECTION_TIMEOUT=10000

# Verify database is reachable
psql $DATABASE_URL -c "SELECT 1"

# Check network latency
ping <database-host>
```

### Issue: Pool exhausted under load

**Symptoms**: `waitingClients` grows, requests slow down

**Solutions**:
```bash
# Increase max pool size (ensure DB can handle it)
DB_POOL_MAX=50

# Check for connection leaks in code
# Ensure all `client.release()` calls are in `finally` blocks

# Review slow queries
# Check pg_stat_activity for long-running queries
```

### Issue: Idle connection errors

**Symptoms**: "Connection terminated unexpectedly" on idle clients

**Solutions**:
```bash
# Reduce idle timeout
DB_POOL_IDLE_TIMEOUT=15000

# Enable TCP keepalive (already configured)
# Check database tcp_keepalives_idle setting
```

### Issue: Too many database connections

**Symptoms**: PostgreSQL logs "too many connections"

**Solutions**:
```bash
# Reduce pool max across all instances
DB_POOL_MAX=10

# Check total connections from all services
# SELECT count(*) FROM pg_stat_activity;

# Increase PostgreSQL max_connections (requires restart)
# max_connections = 200  # in postgresql.conf
```

## Step 6: Code Migration (If Needed)

If you have existing code not using the pool, migrate it:

### Before (Direct connection - ❌ Don't do this)
```javascript
const { Client } = require('pg');

async function getUser(id) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
  await client.end();
  return result.rows[0];
}
```

### After (Using pool - ✅ Do this)
```javascript
const { pool } = require('./src/db/client');

async function getUser(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}
```

### For Transactions (Using explicit client)
```javascript
const { pool } = require('./src/db/client');

async function transferFunds(fromId, toId, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, fromId]);
    await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, toId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release(); // Critical: Always release in finally block
  }
}
```

## Rollback Plan

If you need to rollback to a simpler configuration:

1. Restore previous `src/db/client.js`:
   ```javascript
   const { Pool } = require('pg');
   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   module.exports = { pool };
   ```

2. Remove pool configuration from `.env`:
   ```bash
   # Keep only
   DATABASE_URL=postgresql://...
   ```

3. Restart the application

## Security Checklist

- [ ] Database credentials stored in `.env` only (never in code)
- [ ] `.env` excluded from version control (in `.gitignore`)
- [ ] Production uses strong database password
- [ ] Database user has minimum required privileges
- [ ] SSL/TLS enabled for remote database connections
- [ ] Connection strings use `sslmode=require` in production
- [ ] No database credentials in application logs

## Next Steps

After successful migration:

1. Monitor pool metrics in production for 1-2 weeks
2. Adjust `DB_POOL_MAX` based on observed load patterns
3. Set up alerting on key pool metrics
4. Document any application-specific pool tuning
5. Consider read replicas if read-heavy workload grows

## Support

For detailed information:
- [Database Pooling Documentation](./database-pooling.md)
- [node-postgres Pool Documentation](https://node-postgres.com/features/pooling)
- [PostgreSQL Connection Tuning](https://www.postgresql.org/docs/current/runtime-config-connection.html)
