# Next.js Postgres Latency Tester

Minimal Next.js 16 (App Router) app to benchmark PostgreSQL read/write latency.

Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Use Node.js >= 20.9.0.
3. npm install
4. npm run dev

Open http://localhost:3000 and click "Run Latency Test".

SSL notes

- If your Postgres server does NOT support SSL, set one of the following:
	- Add `?sslmode=disable` to your `DATABASE_URL`, e.g. `postgres://user:pass@host:5432/db?sslmode=disable`
	- Or set env `PGSSLMODE=disable` in `.env`
- If your server requires SSL but uses self-signed certs, either use `?sslmode=no-verify` or set `PGSSLMODE=no-verify`.

Docker

Build: docker build -t pg-latency-tester .
Run: docker run --env DATABASE_URL="$DATABASE_URL" -p 3000:3000 pg-latency-tester
