# CivicPulse Sylhet

A citizen reporting demo for issues within Sylhet City Corporation (SCC). The frontend uses React and Vite, the API uses Express, and persistent data is stored in MySQL-compatible MariaDB.

## Prerequisites

- Node.js 18 or newer
- MySQL 8 or newer or MariaDB 10.6 or newer

## Database setup

Create the application database and a restricted local user:

```sql
CREATE DATABASE civicpulse_bd
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'civicpulse'@'127.0.0.1' IDENTIFIED BY 'change-this-password';
GRANT ALL PRIVILEGES ON civicpulse_bd.* TO 'civicpulse'@'127.0.0.1';
```

Copy `server/.env.example` to `server/.env` and set the database credentials. On startup, the API applies an additive migration that adds a nullable `ward` field to existing reports. Existing users and reports are preserved; reports submitted before ward selection was introduced remain unassigned (`ward` is `NULL`).

### Local Windows MariaDB

The per-user development installation can run without a Windows service. Start MariaDB in one PowerShell terminal:

```powershell
$server = Join-Path $env:LOCALAPPDATA 'CivicPulse\MariaDB\MariaDB 11.8\bin\mariadbd.exe'
$data = Join-Path $env:LOCALAPPDATA 'CivicPulse\data'
& $server --console "--datadir=$data" --bind-address=127.0.0.1 --port=3306
```

Keep that terminal open. The database files and local credentials stay in your Windows user profile and the ignored `server/.env` file. Never commit `.env` credentials.

## Run the app

Open PowerShell in the repository folder. Install root development tools, then install the client and server dependencies:

```powershell
npm.cmd install
npm.cmd run setup
```

If `server/.env` does not exist yet, create it and enter your local MySQL settings:

```powershell
Copy-Item server\.env.example server\.env
notepad server\.env
```

Leave MariaDB running in one terminal. Start both the API and website from the project root in another:

```powershell
npm.cmd run dev
```

- Web app: <http://localhost:5173>
- API health: <http://localhost:5000/api/health>

To sign in, use a demo card on the login screen; in development the cards open the selected citizen or SCC staff dashboard directly. To start only one part, run `npm.cmd run server` or `npm.cmd run client` in the project root.

## Demo citizen accounts

In development, use the demo account buttons to go straight to each citizen dashboard, or choose the SCC admin demo account to open the staff dashboard. The demo credentials are displayed beside each button.

| Name | Email | Password |
|------|-------|----------|
| Demo User | `demo@example.com` | `demo123` |
| Ayesha Rahman | `ayesha@example.com` | `ayesha123` |
| Tanvir Hasan | `tanvir@example.com` | `tanvir123` |

The API seeds demo data idempotently on first startup in development. Public demo sign-in buttons and production demo-user seeding are disabled by default. Existing accounts and reports are not deleted or overwritten.

## Sylhet reporting and administration

The shared `shared/sylhet.js` module defines SCC Ward 1–27, the report categories, priorities, departments, workflow statuses, default map center (24.8949, 91.8687), and approximate SCC location bounds (latitude 24.85–24.95, longitude 91.80–91.93). Citizens select a ward, choose a map pin or explicitly opt out of sharing coordinates, and can add up to three photos. A pin outside the approximate map area receives a warning, not a rejection.

Citizen accounts can view only their own reports and photos. Citizens can confirm a resolution or reopen a resolved issue with a reason; only SCC staff can set a report to resolved. Reports have readable `SCC-YYYY-000001`-style IDs, a status timeline, public responses, and notifications. The report form saves text and pin selections locally as an offline draft; photos are not stored in the draft. API idempotency keys make a retry safe if a connection fails.

SCC staff can select **SCC staff sign in** below the citizen demo accounts, or open <http://localhost:5173/admin> directly. After signing in with an authorized staff account, the operations dashboard provides role-guarded metrics, a report map, status/ward/priority/search filters, CSV export, report assignment, estimated due dates, public responses, private staff notes, audit activity, and approximate nearby duplicate suggestions. The super admin can create officer and read-only viewer accounts. The live inbox uses server-sent events.

On first startup in development, the API creates these staff accounts if they do not already exist:

| Role | Email | Default development password |
|------|-------|-------------------------------|
| Super admin | `admin@scc.local` | `SCCadmin2026!` |
| SCC officer | `officer@scc.local` | `SCCofficer2026!` |

These are local demo credentials only. Override them in `server/.env` before the first run; do not expose them to the internet. Account passwords are never reset by the idempotent seed. In production, set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD`, set a strong random `SESSION_SECRET`, use HTTPS, and configure `CLIENT_ORIGIN` to the exact trusted origin. Development staff seeding is disabled in production.

In development, each citizen demo card signs in directly to that user's dashboard. The SCC admin demo card signs in with the local super-admin credentials above. When production demo access is explicitly enabled, that card instead signs in as a read-only SCC dashboard viewer with fixed demo credentials; it cannot edit reports or manage staff.

## Demo deployment: Vercel, Render Free, and Aiven MySQL

This demo uses **Vercel for the frontend**, **one Render Free web service for the Express API**, and **an external Aiven MySQL database**. The Render Blueprint contains no database service and no disks. The free Render service can sleep when idle and its filesystem is ephemeral; this is intended for a demo, not production citizen data.

1. Create an Aiven MySQL service and database. In Aiven, copy the host, port, database name, username, password, and the service CA certificate. Restrict database access to the Render API if your Aiven plan/network settings allow it.
2. In Vercel, import this repository with the repository root as the project root. The checked-in `vercel.json` builds `client/` and proxies `/api/*` to `https://sylhet-citizen-portal.onrender.com`. If Render gives the service a different URL, update that destination and redeploy Vercel.
3. In Vercel, note the stable production URL (for example, `https://your-project.vercel.app`). Set that exact origin, without a trailing slash, as Render's `CLIENT_ORIGIN`. Browser writes are restricted to this origin.
4. In Render, create a Blueprint from this repository and set the variables listed below in the API service's Environment page. Keep the public demo flag enabled only with a disposable demo database. `SESSION_SECRET` is generated by the Blueprint.
5. Deploy the API. Startup creates/updates the schema, provisions the configured admin, and seeds the three citizen demo accounts and sample reports because the Blueprint enables `ENABLE_DEMO_LOGINS=true`. Seeding is idempotent: existing account passwords are not overwritten and tagged sample reports are not duplicated. Allow startup migrations and Aiven connection retries to finish.
6. Check `https://sylhet-citizen-portal.onrender.com/api/health`; success returns `{"status":"ok","database":"mysql"}`. Startup retries database initialization 30 times at 2-second intervals (up to 60 seconds) before failing. The HTTP port opens before database initialization; `/api/health` returns HTTP 503 while the database is connecting, then HTTP 200 when migrations/seeding complete. The free service may take time to wake after idle. Then deploy/redeploy Vercel and test the app through its Vercel URL.

### Render environment variables

Set these on the `sylhet-citizen-portal` API service in Render. Do not put real credentials in this repository or in Vercel:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `CLIENT_ORIGIN` | The exact Vercel production origin, e.g. `https://your-project.vercel.app` |
| `SESSION_SECRET` | Generated by the Render Blueprint; keep it private |
| `MYSQL_HOST` | Aiven service hostname |
| `MYSQL_PORT` | Aiven service port |
| `MYSQL_USER` | Aiven database username |
| `MYSQL_PASSWORD` | Aiven database password |
| `MYSQL_DATABASE` | Aiven database name |
| `MYSQL_SSL` | `true` |
| `MYSQL_CA_CERT` | Paste the Aiven CA certificate PEM, including its BEGIN/END lines |
| `ADMIN_EMAIL` | Email for the SCC super-admin account |
| `ADMIN_PASSWORD` | Strong unique super-admin password |
| `ENABLE_DEMO_LOGINS` | `true` only for this disposable demo database |

`server/.env.example` has placeholders for local configuration. The API accepts the existing `DB_*` aliases too, but the Render setup uses `MYSQL_*`.

### Vercel environment variables

No Vercel environment variables are required with the current `vercel.json`: it contains the Render API URL. If the Render service URL changes, update the `/api/:path*` rewrite destination in `vercel.json`, commit it, and redeploy. The API's `CLIENT_ORIGIN` must continue to match the exact Vercel URL.

### Database TLS and uploaded photos

`MYSQL_SSL=true` enables TLS. Set `MYSQL_CA_CERT` to the Aiven CA PEM so MySQL verifies the server certificate. A certificate file can instead be provided with `MYSQL_CA_CERT_PATH` when deploying in an environment that supports mounting a file. Production startup refuses to continue without the CA. In development only, TLS without a CA uses an encrypted connection without certificate verification and logs a warning; that fallback is vulnerable to man-in-the-middle attacks.

Photos are stored on the API filesystem under `UPLOAD_DIR` (default `server/data/uploads`) and their metadata is stored in MySQL. Render Free has no persistent disk, so **uploaded photo files can disappear after a restart, redeploy, or instance replacement** even though report records remain. Do not rely on photo retention for this deployment. For durable uploads, integrate Cloudinary or another object store before using the service for real reports.

The public demo credentials below are intentionally visible in the UI and are seeded on startup only when `ENABLE_DEMO_LOGINS=true`. Keep this flag enabled only on a sandbox database with disposable data; do not use these accounts or a public demo database for real citizen information.

| Demo account | Email | Password |
|-------------|-------|----------|
| Citizen demo | `demo@example.com` | `demo123` |
| Citizen demo | `ayesha@example.com` | `ayesha123` |
| Citizen demo | `tanvir@example.com` | `tanvir123` |
| SCC read-only dashboard | `scc-dashboard-demo@scc.local` | `SylhetReadOnly2026!` |

The demo credentials are public and are seeded only when the Render flag is enabled. The SCC demo login is read-only, not the actual super admin account. Demo users and sample reports share the same database, so only enable this on a sandbox database with disposable data; disable it before storing real citizen information.

## Storage and security notes

- The API uses MariaDB/MySQL for application data and server-side session storage. The custom session store persists sessions in the existing `sessions` table so they survive Render restarts; no new dependency or environment variable is needed. Keep Render's `SESSION_SECRET` unchanged to preserve current signed cookies. Rotating it invalidates existing browser sessions, and affected users must sign in again.
- Uploaded images are checked by file signature, limited to 5 MB each and three per report, re-encoded as WebP, and stripped of EXIF metadata. The `UPLOAD_DIR` defaults to `server/data/uploads`; keep this directory private and include it in backups.
- Browser mutations must come from the configured `CLIENT_ORIGIN`; sessions are HTTP-only, SameSite=Lax, path `/`, and valid for 24 hours. The cookie intentionally has no `Domain`, so Vercel's same-origin `/api` rewrite stores it on the Vercel site rather than the Render hostname. Production cookies are Secure; Express trusts the single Render proxy hop to correctly detect HTTPS.
- Keep the database bound to a private interface, use a least-privilege database user, and back up both the MySQL database and private uploads directory.
- OpenStreetMap tiles and Leaflet maps require an internet connection. SCC map bounds are approximate and must not be treated as authoritative ward or legal boundaries. Reverse-geocoding is not enabled.

Run the backend integration tests and frontend report-flow tests with:

```bash
npm test
```

## Build

```bash
npm run build
```

## License

MIT – feel free to fork, modify, and use for learning purposes.
