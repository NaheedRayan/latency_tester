"use client"

import { useState } from 'react'

export default function Page() {
    const [running, setRunning] = useState(false)
    const [results, setResults] = useState(null)
    const [ops, setOps] = useState(10)
    const [conn, setConn] = useState('')
    const [progress, setProgress] = useState(0)
    const [status, setStatus] = useState('')
    const [writeSeries, setWriteSeries] = useState([])
    const [readSeries, setReadSeries] = useState([])



    function Sparkline({
        data,
        line = '#2563eb', // blue-600
        fill = 'rgba(37,99,235,0.12)',
        height = 72,
        strokeWidth = 2,
        showAvg = true,
        showLast = true,
    }) {
        const width = 320
        const n = data.length
        if (!n) return <svg width={width} height={height} />
        const max = Math.max(...data)
        const min = Math.min(...data)
        const range = max - min || 1
        const pad = 4
        const baseY = height - pad
        const toX = (i) => (i / Math.max(1, n - 1)) * (width - pad * 2) + pad
        const toY = (v) => baseY - ((v - min) / range) * (height - pad * 2)

        // line path
        const d = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ')

        // area path
        const area = `M ${toX(0)} ${baseY} ` + data.map((v, i) => `L ${toX(i)} ${toY(v)}`).join(' ') + ` L ${toX(n - 1)} ${baseY} Z`

        const avg = data.reduce((a, b) => a + b, 0) / n
        const avgY = toY(avg)
        const lastX = toX(n - 1)
        const lastY = toY(data[n - 1])

        const gradId = `grad-${Math.abs((line + height).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}`
        return (
            <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
                <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={fill} />
                        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </linearGradient>
                </defs>
                <path d={area} fill={`url(#${gradId})`} stroke="none" />
                {showAvg && <line x1={pad} x2={width - pad} y1={avgY} y2={avgY} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3 3" />}
                <path d={d} fill="none" stroke={line} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
                {showLast && <circle cx={lastX} cy={lastY} r="3" fill={line} />}
            </svg>
        )
    }

    async function runTest() {
        setRunning(true)
        setResults(null)
        setProgress(0)
        setStatus('')
        setWriteSeries([])
        setReadSeries([])
        try {
            // Attempt streaming first for live progress
            const streamRes = await fetch('/api/test-latency', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operations: Number(ops), connectionString: conn || undefined, stream: true })
            })

            const contentType = streamRes.headers.get('content-type') || ''
            if (streamRes.ok && contentType.includes('application/x-ndjson')) {
                const reader = streamRes.body.getReader()
                const decoder = new TextDecoder()
                let buf = ''
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    buf += decoder.decode(value, { stream: true })
                    const lines = buf.split('\n')
                    buf = lines.pop() || ''
                    for (const line of lines) {
                        if (!line.trim()) continue
                        try {
                            const evt = JSON.parse(line)
                            if (evt.type === 'progress') {
                                setProgress(Math.max(0, Math.min(1, evt.progress || 0)))
                                setStatus(`Running ${evt.current}/${evt.total}...`)
                                setResults({ avgWrite: evt.avgWrite, avgRead: evt.avgRead, totalOps: evt.total })
                                if (typeof evt.lastWrite === 'number') setWriteSeries(prev => [...prev, evt.lastWrite])
                                if (typeof evt.lastRead === 'number') setReadSeries(prev => [...prev, evt.lastRead])
                            } else if (evt.type === 'done') {
                                setProgress(1)
                                setStatus('Done')
                                setResults({ avgWrite: evt.avgWrite, avgRead: evt.avgRead, totalOps: evt.totalOps })
                            } else if (evt.type === 'error') {
                                setStatus('Error')
                                setResults({ error: evt.error })
                            }
                        } catch (e) {
                            // ignore parse errors for partial lines
                        }
                    }
                }
            } else {
                // Fallback: non-streaming
                const data = await streamRes.json()
                setResults(data)
                setProgress(1)
                setStatus('Done')
            }
        } catch (err) {
            setResults({ error: err.message || String(err) })
        } finally {
            setRunning(false)
        }
    }

    return (
        <main className="app-center flex items-center justify-center p-3 md:p-4 lg:p-6">
            <div className="w-full max-w-2xl bg-white p-6 md:p-7 rounded-lg shadow">
                <h1 className="text-2xl font-semibold mb-2 text-center">Postgres Latency Tester</h1>
                <p className="text-sm text-gray-500 mb-5 text-center">Measure read/write latency with a simple loop and see live progress and charts.</p>

                <div className="mb-4 text-left">
                    <label className="block text-sm text-gray-600 mb-1">Connection URL (optional)</label>
                    <input
                        type="text"
                        placeholder="postgres://user:password@host:5432/dbname?sslmode=disable"
                        value={conn}
                        onChange={(e) => setConn(e.target.value)}
                        className="w-full border rounded-md px-2.5 py-2 text-sm"
                        spellCheck={false}
                    />
                    <p className="text-xs text-gray-500 mt-1">If empty, the server will use DATABASE_URL from the environment.</p>
                </div>

                <div className="mb-4 flex items-center justify-center gap-2">
                    <label className="text-sm text-gray-600">Operations</label>
                    <select value={ops} onChange={(e) => setOps(e.target.value)} className="border px-2.5 py-1.5 rounded-md text-sm">
                        <option value={10}>10</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                </div>



                <button onClick={runTest} className="w-full bg-gray-900 text-white py-2.5 rounded-md hover:bg-black disabled:opacity-60" disabled={running}>
                    {running ? 'Running...' : 'Run Latency Test'}
                </button>

                <div className="h-px bg-gray-200 my-5" />

                <div className="mt-6">
                    {running && (
                        <div>
                            <div className="w-full h-2 bg-gray-200 rounded">
                                <div className="h-2 bg-gray-900 rounded" style={{ width: `${Math.floor(progress * 100)}%` }} />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{status || 'Testing... ⏱️'}</div>
                        </div>
                    )}

                    {results && results.error && (
                        <div className="text-red-600 mt-2">Error: {results.error}</div>
                    )}

                    {results && !results.error && (
                        <div className="mt-4 grid lg:grid-cols-2 gap-4">
                            <div className="text-left text-sm text-gray-700">
                                <div className="font-medium mb-2">Summary</div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1">
                                    <div>📈 Avg Write: <span className="font-mono">{results.avgWrite.toFixed(2)} ms</span></div>
                                    <div>📊 Avg Read: <span className="font-mono">{results.avgRead.toFixed(2)} ms</span></div>
                                    <div>🔁 Total Ops: <span className="font-mono">{results.totalOps}</span></div>
                                </div>

                            </div>
                            <div className="text-left">
                                <div className="text-sm text-gray-700 font-medium mb-1">Latency charts</div>
                                <div className="bg-gray-50 border rounded-md p-3 space-y-3">
                                    <div>
                                        <div className="text-xs text-gray-500 mb-1 flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#2563eb' }}></span> Write (ms)</div>
                                        <Sparkline data={writeSeries} line="#2563eb" fill="rgba(37,99,235,0.12)" height={80} />
                                    </div>
                                    <div>
                                        <div className="text-xs text-gray-500 mb-1 flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#16a34a' }}></span> Read (ms)</div>
                                        <Sparkline data={readSeries} line="#16a34a" fill="rgba(22,163,74,0.12)" height={80} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </main>
    )
}
