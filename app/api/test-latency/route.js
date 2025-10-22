import { NextResponse } from 'next/server'
import { Pool } from 'pg'

// Ensure Node.js runtime (pg is not supported on edge) and disable caching
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function createPool(urlOverride) {
    const url = urlOverride || process.env.DATABASE_URL
    if (!url) {
        throw new Error(
            'DATABASE_URL is not set. Create a .env (or .env.local) with:\nDATABASE_URL=postgres://user:password@host:5432/dbname'
        )
    }
    let ssl
    try {
        const u = new URL(url)
        const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
        // Resolve SSL behavior from sslmode or env overrides
        const sslModeRaw = (u.searchParams.get('sslmode') || process.env.PGSSLMODE || process.env.DATABASE_SSL || '').toString().toLowerCase()
        if (sslModeRaw === 'disable') {
            ssl = false
        } else if (sslModeRaw === 'require' || sslModeRaw === 'verify-full' || sslModeRaw === 'verify-ca') {
            ssl = true
        } else if (sslModeRaw === 'no-verify' || sslModeRaw === 'allow' || sslModeRaw === 'prefer') {
            ssl = { rejectUnauthorized: false }
        } else {
            // Heuristic: use SSL by default for non-local hosts; allow self-signed
            ssl = isLocal ? undefined : { rejectUnauthorized: false }
        }

        // Basic sanity to avoid SASL error when password is missing
        // u.password is undefined if omitted in the URL
        if (typeof u.password === 'undefined') {
            throw new Error(
                'DATABASE_URL appears to be missing a password (format: postgres://user:password@host:port/db). If your password contains special characters like @, :, /, ?, # or &, URL-encode it.'
            )
        }
    } catch (e) {
        // Invalid URL or missing password
        const hint =
            'Ensure DATABASE_URL is a valid Postgres URI, e.g. postgres://user:password@host:5432/dbname. If the password has special characters, URL-encode it.'
        throw new Error(`${hint}\n${e?.message || ''}`.trim())
    }
    return new Pool({ connectionString: url, ssl })
}

function getPool(urlOverride) {
    if (urlOverride) {
        // For a per-request override, return a dedicated pool (not global)
        return createPool(urlOverride)
    }
    if (!globalThis.__pgLatencyPool) {
        globalThis.__pgLatencyPool = createPool()
    }
    return globalThis.__pgLatencyPool
}

async function ensureTable(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS latency_test (
    id SERIAL PRIMARY KEY,
    payload TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`)
}

async function writeOnce(pool, payload) {
    const start = Date.now()
    await pool.query('INSERT INTO latency_test (payload) VALUES ($1)', [payload])
    return Date.now() - start
}

async function readOnce(pool) {
    const start = Date.now()
    const res = await pool.query('SELECT id, payload FROM latency_test ORDER BY id DESC LIMIT 1')
    return { time: Date.now() - start, row: res.rows[0] }
}

async function cleanupTable(pool) {
    try {
        await pool.query('TRUNCATE TABLE latency_test')
        return 'truncate'
    } catch (_) {
        // Fallback if TRUNCATE is not permitted
        await pool.query('DELETE FROM latency_test')
        return 'delete'
    }
}

export async function POST(req) {
    // Support streaming NDJSON progress via request body { stream: true }
    const encoder = new TextEncoder()
    try {
        const body = await req.json()
        const operations = Math.max(1, Number(body.operations) || 50)
        const connectionString = typeof body.connectionString === 'string' && body.connectionString.trim() ? body.connectionString.trim() : undefined
        const stream = Boolean(body.stream)

        if (stream) {
            // Streaming NDJSON response
            const rs = new ReadableStream({
                start: async (controller) => {
                    let pool
                    try {
                        pool = getPool(connectionString)
                        await ensureTable(pool)
                        const writeTimes = []
                        const readTimes = []

                        for (let i = 0; i < operations; i++) {
                            const w = await writeOnce(pool, `payload-${Date.now()}-${Math.random()}`)
                            writeTimes.push(w)
                            const r = await readOnce(pool)
                            readTimes.push(r.time)

                            const avgWrite = writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length
                            const avgRead = readTimes.reduce((a, b) => a + b, 0) / readTimes.length
                            const progress = (i + 1) / operations
                            const line = JSON.stringify({ type: 'progress', current: i + 1, total: operations, progress, avgWrite, avgRead, lastWrite: w, lastRead: r.time }) + '\n'
                            controller.enqueue(encoder.encode(line))
                        }

                        const avgWrite = writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length
                        const avgRead = readTimes.reduce((a, b) => a + b, 0) / readTimes.length
                        try { await cleanupTable(pool) } catch { }
                        const finalLine = JSON.stringify({ type: 'done', avgWrite, avgRead, totalOps: operations }) + '\n'
                        controller.enqueue(encoder.encode(finalLine))
                        controller.close()
                    } catch (err) {
                        const msg = String(err?.message || err || '')
                        let friendly = msg
                        if (/client password must be a string/i.test(msg)) {
                            friendly = 'Invalid Postgres credentials: password is missing or not a string. Check connection string and URL-encode special characters.'
                        }
                        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: friendly }) + '\n'))
                        controller.close()
                    } finally {
                        // Close per-request pool if we created a dedicated pool
                        if (connectionString && pool && typeof pool.end === 'function') {
                            try { await pool.end() } catch { }
                        }
                    }
                }
            })
            return new Response(rs, {
                headers: {
                    'Content-Type': 'application/x-ndjson; charset=utf-8',
                    'Cache-Control': 'no-cache, no-transform',
                }
            })
        }

        // Non-streaming mode
        const pool = getPool(connectionString)
        await ensureTable(pool)
        const writeTimes = []
        const readTimes = []
        for (let i = 0; i < operations; i++) {
            const w = await writeOnce(pool, `payload-${Date.now()}-${Math.random()}`)
            writeTimes.push(w)
            const r = await readOnce(pool)
            readTimes.push(r.time)
        }
        const avgWrite = writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length
        const avgRead = readTimes.reduce((a, b) => a + b, 0) / readTimes.length
        try { await cleanupTable(pool) } catch { }
        if (connectionString && typeof pool.end === 'function') {
            try { await pool.end() } catch { }
        }
        return NextResponse.json({ avgWrite, avgRead, totalOps: operations })
    } catch (err) {
        // Improve error clarity for common SASL password/SSL issues
        const msg = String(err?.message || err || '')
        let friendly = msg
        if (/client password must be a string/i.test(msg)) {
            friendly = 'Invalid Postgres credentials: password is missing or not a string. Check connection string and URL-encode special characters.'
        }
        return NextResponse.json({ error: friendly }, { status: 500 })
    }
}

export async function GET() {
    try {
        const pool = getPool()
        await pool.query('SELECT 1')
        return NextResponse.json({ ok: true })
    } catch (err) {
        return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 500 })
    }
}
