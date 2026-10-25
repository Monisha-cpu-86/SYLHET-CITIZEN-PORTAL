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

The API seeds demo data idempotently on first startup in development. Demo accounts are hidden in production. Existing accounts and reports are not deleted or overwritten.

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

## Deploy to Vercel and Render

Use **Vercel for the React/Vite frontend** and **Render for the Express API and MySQL database**. Vercel does not host the app's MySQL server; Render provides managed PostgreSQL, not managed MySQL. This repository therefore includes a Render Blueprint that runs MySQL 8.4 as a private Docker service with a persistent disk, plus the Node API with a persistent photo-upload disk. These are paid Render resources (`starter` services and persistent storage); review Render's current pricing before creating them. Do not use an ephemeral/free service for the database.

1. In Render, choose **New → Blueprint**, connect this repository, and let Render read `render.yaml`. The Blueprint creates `civicpulse-mysql` and `civicpulse-sylhet-api` in Singapore.
2. Provide secure values when prompted for `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `CLIENT_ORIGIN`. Use a new, long random value for each database/admin password. `CLIENT_ORIGIN` must be the exact HTTPS production origin shown in your Vercel project settings (no trailing slash). Render generates `SESSION_SECRET`. Keep these values in Render's environment settings, never in source control.
3. Wait for MySQL and the API to become healthy. The API retries database initialization while MySQL starts. The configured production admin account is created idempotently; its password is not changed by later starts if the account already exists.
4. In Vercel, keep the project root at the repository root and redeploy from `main`. `vercel.json` builds the client and proxies `/api/*` to `https://civicpulse-sylhet-api.onrender.com`. If Render assigns a different public service URL, update this rewrite to that URL and push the change.

The Render API and MySQL must be in the same region so the API can connect to MySQL using the private hostname `civicpulse-mysql:3306`. MySQL is not exposed to the public internet. The API Blueprint attaches persistent disks for MySQL data and report photos. Back up MySQL with database-native exports; do not rely on disk snapshots as the only database backup. Production does not seed the local citizen demo users or sample reports.

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
