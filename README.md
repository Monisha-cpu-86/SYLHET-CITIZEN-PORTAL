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

In a second terminal, from the project root:

```bash
npm install
npm run dev
```

- Web app: <http://localhost:5173>
- API health: <http://localhost:5000/api/health>

## Demo citizen accounts

Use the demo account buttons on the sign-in screen to fill in credentials.

| Name | Email | Password |
|------|-------|----------|
| Demo User | `demo@example.com` | `demo123` |
| Ayesha Rahman | `ayesha@example.com` | `ayesha123` |
| Tanvir Hasan | `tanvir@example.com` | `tanvir123` |

The API seeds demo data idempotently on first startup. Existing accounts and reports are not deleted or overwritten.

## Sylhet reporting and administration

The shared `shared/sylhet.js` module defines SCC Ward 1–27, the report categories, priorities, departments, workflow statuses, default map center (24.8949, 91.8687), and approximate SCC location bounds (latitude 24.85–24.95, longitude 91.80–91.93). Citizens select a ward, choose a map pin or explicitly opt out of sharing coordinates, and can add up to three photos. A pin outside the approximate map area receives a warning, not a rejection.

Citizen accounts can view only their own reports and photos. Citizens can confirm a resolution or reopen a resolved issue with a reason; only SCC staff can set a report to resolved. Reports have readable `SCC-YYYY-000001`-style IDs, a status timeline, public responses, and notifications. The report form saves text and pin selections locally as an offline draft; photos are not stored in the draft. API idempotency keys make a retry safe if a connection fails.

SCC staff can select **SCC staff sign in** below the citizen demo accounts, or open <http://localhost:5173/admin> directly. After signing in with an authorized staff account, the operations dashboard provides role-guarded metrics, a report map, status/ward/priority/search filters, CSV export, report assignment, estimated due dates, public responses, private staff notes, audit activity, and approximate nearby duplicate suggestions. The super admin can create officer and read-only viewer accounts. The live inbox uses server-sent events.

On first startup in development, the API creates these staff accounts if they do not already exist:

| Role | Email | Default development password |
|------|-------|-------------------------------|
| Super admin | `admin@scc.local` | `SCCadmin2026!` |
| SCC officer | `officer@scc.local` | `SCCofficer2026!` |

These are local demo credentials only. Override them in `server/.env` before the first run; do not expose them to the internet. Account passwords are never reset by the idempotent seed. In production, set strong `ADMIN_PASSWORD` and `OFFICER_PASSWORD` values for initial provisioning, set a strong random `SESSION_SECRET`, use HTTPS, and configure `CLIENT_ORIGIN` to the exact trusted origin. Development staff seeding is disabled in production.

## Deploy to Vercel

Import this repository into Vercel with the project root set to the repository root. `vercel.json` installs the client and server dependencies, builds the Vite client, serves the SPA, and routes `/api/*` to the Express function. GitHub pushes to the configured production branch will trigger deployments.

Before the first deployment, configure these Vercel environment variables for Production (and Preview if you use preview deployments):

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `production`. |
| `SESSION_SECRET` | A long, random secret unique to this deployment. |
| `CLIENT_ORIGIN` | The exact HTTPS origin used by the app, such as `https://your-project.vercel.app` or your custom domain. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Connection details for a managed MySQL/MariaDB database reachable from Vercel. Use a restricted production database user and a provider with TLS support. |

The database must be provisioned separately; Vercel does not run MySQL. The function applies the app's additive schema migration on startup. Production does not seed the local demo citizens or development staff accounts. Provision your production staff accounts through a secure, private process before relying on the admin console.

**Production storage limitation:** report photos currently use the server's local filesystem (`UPLOAD_DIR`). Vercel function filesystems are ephemeral and not suitable for durable uploads. Configure a persistent object-storage integration before enabling photo uploads in production; this project does not currently include one. The live inbox also uses server-sent events, which are not a durable real-time transport on serverless functions.

## Storage and security notes

- The API uses MariaDB/MySQL for application data and server-side session storage. Startup migrations are additive and retain existing citizens and reports.
- Uploaded images are checked by file signature, limited to 5 MB each and three per report, re-encoded as WebP, and stripped of EXIF metadata. The `UPLOAD_DIR` defaults to `server/data/uploads`; keep this directory private and include it in backups.
- Browser mutations must come from the configured `CLIENT_ORIGIN`; sessions are HTTP-only and SameSite=Lax. Production cookies are Secure.
- Keep the database bound to a private interface, use a least-privilege database user, and back up both the MySQL database and private uploads directory.
- OpenStreetMap tiles and Leaflet maps require an internet connection. SCC map bounds are approximate and must not be treated as authoritative ward or legal boundaries. Reverse-geocoding is not enabled.

The automated backend tests can be run with:

```bash
npm test --prefix server
```

## Build

```bash
npm run build
```

## License

MIT – feel free to fork, modify, and use for learning purposes.
