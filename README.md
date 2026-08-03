# IdeaHub

A modern web application for managing internal improvement ideas, designed for employees to submit, review, approve, execute, and track ideas within an organization.

## Features

### Core Functionality
- **Idea Submission**: Employees can submit improvement ideas with title, description, benefits, effort estimation, tags, and a target department
- **Review & Approval**: Power users and admins can review, approve, or reject submitted ideas
- **Idea Execution**: Approved ideas can be claimed and worked on by any user
- **Progress Steps**: Assignees can log progress notes on in-progress ideas
- **Completion Tracking**: Users can mark their claimed ideas as completed
- **Activity Timeline**: Full audit trail of all actions taken on each idea
- **Status Views**: Dedicated pages for my ideas and for approved, in-progress, and completed ideas

### Dashboard & Analytics
- Real-time statistics (submitted, approved, in-progress, done, rejected)
- Idea counts per department
- Monthly trend charts showing completed ideas over time
- Average time metrics (submission to approval, approval to completion)
- Top contributors leaderboard (power users and admins)
- Regular users see statistics scoped to their own ideas

### Reporting
- Advanced filtering (status, department, date range, submitter, assignee, tags)
- Pagination and CSV export functionality for data analysis
- Comprehensive reporting interface

### Departments (Admin Only)
- Manage the list of target departments (create, rename, reorder, delete)
- Per-department notification email addresses and Webex space (room) IDs

### Notifications (Email & Webex)
- Two independent, coexisting channels: email (SMTP) and Webex (bot messages); an admin can enable either or both
- Admin-managed SMTP configuration on the **Email settings** page (server, from address, notification language, optional subject template), stored in the database with the SMTP password encrypted
- Admin-managed Webex configuration on the **Webex settings** page (bot access token stored encrypted, message language). Per-submitter lifecycle notifications are always private 1:1 bot messages; department new-idea notifications can additionally post to Webex spaces the admin configures per department (the bot must be a member of each space)
- New-idea notification sent to the target department's notification addresses (email and/or 1:1 Webex message) and to the department's configured Webex spaces, over every enabled channel (best-effort — delivery problems never block the request)
- Per-idea lifecycle notifications: the submitter can opt in (a toggle on the create form and on the idea's details page, shown only when at least one channel is enabled) to be notified when their idea is approved, rejected, claimed, completed, or gets a progress step. A change the submitter makes themselves never notifies them, and delivery is best-effort like the department notifications
- Test buttons (test email / test Webex message) to verify each configuration

### Internationalization
- Bilingual UI — Slovak (default) and English, switchable in the app bar and persisted in the browser
- Email notifications use the admin-configured language

### User Management (Admin Only)
- Create, edit, and delete users
- Role-based access control (User, Power User, Admin)
- User statistics (submitted ideas, assigned ideas)

### Security & Authentication
- Session-based authentication with bcrypt password hashing (sessions stored in MongoDB with a 7-day TTL)
- Optional corporate SSO via OIDC authorization-code flow with PKCE (see [Single Sign-On (SSO)](#single-sign-on-sso))
- Self-service password change for local accounts
- Role-based access control (RBAC)
- CSRF protection via custom header validation
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Input validation using Zod with ObjectId format enforcement
- Protection against CSV injection in report exports
- Session invalidation on role/email changes
- Graceful server shutdown (SIGTERM/SIGINT)
- Admin self-protection (cannot delete own account or change own role)
- Rate limiting on the API and stricter limits on sensitive endpoints (login, password change, SSO, idea submission)

## Tech Stack

### Backend
- **Runtime**: Node.js 22+
- **Framework**: Express.js
- **Database**: MongoDB with Prisma ORM
- **Authentication**: express-session (MongoDB session store) with bcrypt; openid-client for SSO/OIDC
- **Email**: Nodemailer with admin-managed SMTP settings
- **Webex**: Webex REST API (bot 1:1 messages and group-space posts) via native fetch, admin-managed settings
- **Security**: Helmet, express-rate-limit
- **Validation**: Zod
- **Testing**: Jest + Supertest

### Frontend
- **Framework**: Vue 3 (Composition API)
- **UI Library**: Vuetify 3
- **State Management**: Pinia
- **Routing**: Vue Router
- **Internationalization**: vue-i18n (Slovak & English)
- **Charts**: Chart.js with vue-chartjs
- **HTTP Client**: Axios
- **Build Tool**: Vite
- **Testing**: Vitest

### DevOps
- **Containerization**: Docker & Docker Compose
- **Reverse Proxy**: Nginx (for frontend in production)
- **E2E Testing**: Playwright
- **CI**: GitHub Actions (backend, frontend, and E2E test workflows)

## Project Structure

```
idea-hub/
├── backend/                 # Express.js backend
│   ├── prisma/
│   │   ├── schema.prisma   # Database schema
│   │   └── seed.ts         # Database seeding script
│   ├── src/
│   │   ├── __tests__/      # Jest unit/route tests (mocked Prisma)
│   │   ├── __integration__/# Jest integration tests (real MongoDB)
│   │   ├── config/         # Mail & SSO configuration
│   │   ├── lib/            # Prisma client
│   │   ├── middleware/     # Auth & RBAC middleware
│   │   ├── routes/         # API routes (auth, sso, ideas, users, reports, departments, mail-settings, webex-settings)
│   │   ├── types/          # TypeScript types
│   │   ├── utils/          # Validation, mailer & templates, bootstrap, SSO pruning
│   │   └── index.ts        # Server entry point
│   ├── Dockerfile
│   └── package.json
├── frontend/               # Vue 3 frontend
│   ├── src/
│   │   ├── __tests__/     # Vitest unit tests
│   │   ├── api/           # API client modules
│   │   ├── components/    # Reusable components
│   │   ├── i18n/          # Locale catalogs (sk, en)
│   │   ├── layouts/       # Layout components
│   │   ├── pages/         # Page components
│   │   ├── plugins/       # Vuetify setup
│   │   ├── router/        # Vue Router config
│   │   ├── stores/        # Pinia stores
│   │   ├── styles/        # Global styles
│   │   ├── types/         # TypeScript types
│   │   ├── App.vue
│   │   └── main.ts
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── e2e/                    # Playwright E2E tests (start their own servers + mock IdP)
├── dev/                    # Dev & testing kits (Keycloak SSO kit, mail testing, IAM onboarding)
├── docs/                   # Deployment runbook & project docs
├── .github/workflows/      # CI (tests, E2E, PR checks)
├── playwright.config.ts
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
└── README.md
```

## Prerequisites

- **Node.js** 22.12 or higher
- **npm** or **yarn**
- **MongoDB** 7.x (or use Docker)
- **Docker** & **Docker Compose** (for containerized deployment)

## Getting Started

### Option 1: Docker (Recommended)

This is the easiest way to get started. Docker will handle all dependencies and setup.

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd idea-hub
   ```

2. **Create environment file**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and update values if needed:
   ```env
   # MongoDB now runs with authentication. docker-compose uses these to create the
   # mongod root user and to build the backend's credentialed DATABASE_URL.
   MONGO_ROOT_USER=root
   MONGO_ROOT_PASSWORD=example-dev-password
   # For a host-run backend (VS Code debug) DATABASE_URL points at localhost; inside
   # docker-compose the backend reaches Mongo at host `mongodb` and the credentialed
   # URL is composed from MONGO_ROOT_USER/MONGO_ROOT_PASSWORD automatically.
   DATABASE_URL="mongodb://root:example-dev-password@localhost:27017/ideahub?replicaSet=rs0&authSource=admin&directConnection=true"
   SESSION_SECRET="your-super-secret-session-key-change-in-production"
   # Required because NODE_ENV=production below: AES-256-GCM key that encrypts the
   # admin-set SMTP password. The backend fails fast at boot without it, and
   # `docker compose up` stops immediately if it's unset. Generate with the command
   # in the security note below. (Host-run dev with NODE_ENV=development instead
   # generates an ephemeral key.)
   MAIL_SETTINGS_KEY="your-64-hex-char-key-change-in-production"
   NODE_ENV="production"
   BACKEND_PORT=3001
   VITE_API_URL="http://localhost:3001"
   ```

   > **Security — before ANY shared or production deployment:**
   > - **Generate a strong `SESSION_SECRET`** (never ship the placeholder above):
   >   ```bash
   >   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   >   ```
   > - **Generate a `MAIL_SETTINGS_KEY`** the same way (64 hex chars). It is
   >   **required outside development** — the backend refuses to boot without it and
   >   both compose files fail-fast if it's unset. It encrypts the SMTP password and
   >   the Webex bot token an admin later sets on the **Email settings** / **Webex
   >   settings** pages; keep it stable, or previously saved secrets become
   >   undecryptable.
   > - **Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` to unique, non-default values.** The
   >   bootstrap admin is created on first run from these; use a long, random
   >   password (12+ characters — the app enforces a 12-char minimum for
   >   admin-managed passwords).
   > - The placeholder values here and the demo accounts below are **for local
   >   development only**.

3. **Build and start containers**
   ```bash
   docker-compose up -d
   ```

   > **MongoDB authentication (one-time upgrade step).** Mongo now runs as an
   > authenticated replica set (an internal keyFile is generated automatically into
   > a named volume on first boot). Auth is only established on a **fresh** data
   > volume, so if you are **upgrading an existing deployment** whose Mongo volume
   > predates this change, recreate the volume **once**:
   > ```bash
   > docker compose down -v && docker compose up -d
   > ```
   > `down -v` **erases all Mongo data in that volume** — intended here because the
   > pre-auth volume must be rebuilt. Fresh clones need no extra step.

4. **Seed the database** (first time only)
   ```bash
   docker-compose exec backend npm run prisma:seed
   ```

5. **Access the application**
   - Frontend: http://localhost
   - Backend API: http://localhost:3001
   - MongoDB: localhost:27017

6. **Login with demo accounts** *(seeded by `prisma:seed` — LOCAL DEVELOPMENT ONLY)*
   - **Admin**: admin@ideahub.com / admin123
   - **Power User**: power@ideahub.com / power123
   - **Users**: john@ideahub.com, jane@ideahub.com, bob@ideahub.com / user123

   The seed also creates two departments (Všeobecné, Marketing) and sample ideas in every status.

   > **Warning:** These are well-known default credentials created by the seed
   > script. Never run `prisma:seed` against a shared or production database, and
   > change any default admin credentials before exposing the app.

### Option 2: Local Development

For active development without Docker.

#### Backend Setup

1. **Install dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Set up environment**
   ```bash
   cp ../.env.example ../.env
   ```

   Update `DATABASE_URL` to point to your local MongoDB:
   ```env
   DATABASE_URL="mongodb://localhost:27017/ideahub"
   ```

3. **Generate Prisma Client**
   ```bash
   npm run prisma:generate
   ```

4. **Push database schema**
   ```bash
   npx prisma db push
   ```

5. **Seed the database**
   ```bash
   npm run prisma:seed
   ```

6. **Start development server**
   ```bash
   npm run dev
   ```

   Backend will run on http://localhost:3001

#### Frontend Setup

1. **Install dependencies**
   ```bash
   cd frontend
   npm install
   ```

2. **Start development server**
   ```bash
   npm run dev
   ```

   Frontend will run on http://localhost:5173

## Available Scripts

### Root Level

```bash
npm run dev              # Start backend and frontend in dev mode (concurrently)
npm run build            # Build backend and frontend
npm run test             # Run backend + frontend unit tests
npm run test:backend     # Backend tests only
npm run test:frontend    # Frontend tests only
npm run test:e2e         # Playwright E2E suite (starts its own servers)
npm run prisma:generate  # Generate Prisma Client
npm run prisma:seed      # Seed database with test data
npm run docker:build     # Build Docker images
npm run docker:up        # Start Docker containers
npm run docker:down      # Stop Docker containers
npm run docker:logs      # Tail Docker container logs
```

### Backend

```bash
npm run dev              # Start development server with hot reload
npm run build            # Compile TypeScript to JavaScript
npm run start            # Start production server
npm run test             # Run Jest unit/route tests (no database needed)
npm run test:integration # Run integration tests (requires a running MongoDB)
npm run prisma:generate  # Generate Prisma Client
npm run prisma:migrate   # Run database migrations
npm run prisma:seed      # Seed database with test data
npm run prisma:studio    # Open Prisma Studio (database GUI)
```

### Frontend

```bash
npm run dev              # Start Vite dev server
npm run build            # Type-check and build for production
npm run preview          # Preview production build
npm run test             # Run Vitest unit tests
npm run test:watch       # Vitest in watch mode
```

## API Documentation

### Authentication Endpoints

- `GET /api/auth/config` - Public: whether SSO is enabled (`{ ssoEnabled }`)
- `POST /api/auth/login` - Login with email and password (local accounts only)
- `POST /api/auth/logout` - Logout current user (SSO sessions may return a `redirectTo` for RP-initiated logout)
- `POST /api/auth/change-password` - Change own password (local accounts only)
- `GET /api/auth/me` - Get current user info
- `GET /api/auth/sso/login` - Begin OIDC login (redirects to the corporate IAM)
- `GET /api/auth/sso/callback` - OIDC redirect URI; completes login and sets the session

### Options Endpoint

- `GET /api/options` - Authenticated: consolidated runtime UI flags for the app, as `{ mailEnabled, webexEnabled, ssoShowLogout }` (any logged-in user). `mailEnabled` / `webexEnabled` (channel effectively enabled) together drive the per-idea notify toggle — it appears when at least one is true; `ssoShowLogout` (`SSO_SHOW_LOGOUT`) re-exposes the in-app logout button for SSO users. Exposes only these booleans — no admin configuration.

### Ideas Endpoints

- `GET /api/ideas` - Get all ideas (with filters and pagination)
- `GET /api/ideas/:id` - Get single idea with events and progress steps
- `POST /api/ideas` - Create new idea (emails the target department when mail is configured)
- `PATCH /api/ideas/:id` - Update idea (submitter only, while SUBMITTED)
- `PATCH /api/ideas/:id/approve` - Approve idea (Power User/Admin)
- `PATCH /api/ideas/:id/reject` - Reject idea (Power User/Admin)
- `PATCH /api/ideas/:id/claim` - Claim and start working on idea
- `PATCH /api/ideas/:id/complete` - Mark idea as completed (assignee only)
- `PATCH /api/ideas/:id/notify` - Toggle the submitter's lifecycle-email opt-in (submitter only, any status)
- `POST /api/ideas/:id/steps` - Add progress step to in-progress idea (assignee only)
- `DELETE /api/ideas/:id` - Delete idea (Admin only)

### Reports Endpoints

- `GET /api/reports/summary` - Dashboard summary statistics (regular users: own ideas only)
- `GET /api/reports/by-department` - Idea counts per department (regular users: own ideas only)
- `GET /api/reports/monthly-trend` - Monthly completion trend (regular users: own ideas only)
- `GET /api/reports/top-contributors` - Top contributors (Power User/Admin)
- `GET /api/reports/filtered` - Filtered ideas with pagination (with CSV export)

### Departments Endpoints

- `GET /api/departments` - List departments (notification emails and Webex space IDs visible to admins only)
- `POST /api/departments` - Create department (Admin only)
- `PATCH /api/departments/reorder` - Reorder departments (Admin only)
- `PATCH /api/departments/:id` - Update department name / notification emails / Webex space IDs (Admin only)
- `DELETE /api/departments/:id` - Delete department (Admin only; refused for the last department or one that has ideas)

### Email Settings Endpoints (Admin Only)

- `GET /api/mail-settings` - Get SMTP configuration (the password is never returned)
- `PUT /api/mail-settings` - Save SMTP configuration (password stored encrypted)
- `POST /api/mail-settings/test` - Send a test email using the saved configuration

### Webex Settings Endpoints (Admin Only)

- `GET /api/webex-settings` - Get Webex configuration (the bot token is never returned)
- `PUT /api/webex-settings` - Save Webex configuration (bot token stored encrypted)
- `POST /api/webex-settings/test` - Send a test Webex message using the saved configuration
- `GET /api/webex-settings/rooms` - List the bot's Webex spaces (id + title) for the department space picker; returns an empty list with a reason code when Webex is disabled or unreachable

### Users Endpoints (Admin Only)

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get single user
- `POST /api/users` - Create new user
- `PATCH /api/users/:id` - Update user (cannot change own role; SSO-managed users cannot be edited)
- `DELETE /api/users/:id` - Delete user (cannot delete self, SSO-managed users, or users with ideas)

### Miscellaneous

- `GET /health` - Liveness check (`{ status: "ok", timestamp }`)

## User Roles & Permissions

### USER
- Submit new ideas
- View all ideas (global list and own ideas)
- Claim approved ideas for execution
- Log progress steps and mark claimed ideas as completed
- Dashboard and reports scoped to own ideas

### POWER_USER
- All USER permissions
- Access to review queue
- Approve or reject submitted ideas
- Organization-wide dashboard, reports, and top-contributors view

### ADMIN
- All POWER_USER permissions
- Manage users (create, edit, delete, change roles)
- Manage departments, their notification emails, and Webex spaces
- Configure email (SMTP) and Webex notification settings
- Delete ideas

## Database Schema

### User Model
- `id`: Unique identifier
- `name`: User's full name
- `email`: Unique email address
- `passwordHash`: Bcrypt hashed password (absent for SSO-managed users)
- `role`: USER | POWER_USER | ADMIN
- `authProvider`: LOCAL | SSO
- `ssoSub`: OIDC subject identifier (SSO users)
- `department`: Department/org unit synced from the IdP (SSO users)
- `createdAt`, `updatedAt`: Timestamps

### Idea Model
- `id`: Unique identifier
- `title`: Idea title (5-120 chars)
- `description`: Detailed description
- `benefits`: Expected benefits
- `effort`: Effort estimation (< 1 day, 1-3 days, > 3 days)
- `status`: SUBMITTED | APPROVED | IN_PROGRESS | DONE | REJECTED
- `tags`: Array of tag strings
- `departmentId`: Target department
- `submitterId`: User who submitted
- `approverId`: User who approved (nullable)
- `assigneeId`: User working on it (nullable)
- `notifyOnChange`: Submitter opt-in to lifecycle-change email (nullable Boolean; `null` on pre-feature ideas, backfilled to `false` at boot)
- `submittedAt`, `approvedAt`, `startedAt`, `completedAt`, `rejectedAt`: Timestamps

### Department Model
- `id`: Unique identifier
- `name`: Unique department name
- `order`: Display order
- `notificationEmails`: Addresses notified about new ideas targeting this department
- `webexRoomIds`: Webex space (room) IDs that new-idea notifications for this department are posted to

### IdeaEvent Model
- `id`: Unique identifier
- `ideaId`: Related idea
- `type`: SUBMITTED | APPROVED | REJECTED | CLAIMED | STARTED | COMPLETED | UPDATED | CHANGE_REQUESTED
- `byUserId`: User who performed action
- `timestamp`: When event occurred
- `note`: Optional note/comment

### IdeaStep Model
- `id`: Unique identifier
- `ideaId`: Related idea
- `text`: Progress note
- `createdAt`: Timestamp

### MailSettings Model (singleton)
- SMTP `host`, `port`, `secure`, `username`, and the password stored encrypted (AES-256-GCM)
- `from` address, notification `language` (en/sk), optional `subjectTemplate`
- `enabled`: Master switch for outbound mail

### WebexSettings Model (singleton)
- Webex bot access token stored encrypted (AES-256-GCM)
- Message `language` (en/sk)
- `enabled`: Master switch for Webex notifications

## Testing

IdeaHub has **comprehensive test coverage** across backend, frontend, and end-to-end suites.

### Test Coverage Summary

- **Backend**: 664 tests across 19 Jest suites (run against mocked Prisma — no database needed)
- **Backend integration**: 91 tests across 11 Jest suites against a real MongoDB (`npm run test:integration`)
- **Frontend**: 520 Vitest tests across 19 files (pages, stores, API client, i18n)
- **E2E**: Playwright scenarios covering local & SSO login, RBAC, the idea lifecycle, departments, email settings, Webex settings, the per-idea notification opt-in, and i18n

**What's Tested:**
- ✅ Authentication, sessions & password change
- ✅ SSO/OIDC flow (login, callback, provisioning, break-glass)
- ✅ Ideas CRUD & workflow transitions
- ✅ Departments CRUD, reordering & notification emails
- ✅ Email settings, mail templates (new-idea & lifecycle) & mailer behavior
- ✅ Webex settings, message templates (markdown escaping) & sender behavior
- ✅ Reports & analytics (including role scoping)
- ✅ User management & RBAC enforcement
- ✅ Validation schemas & error handling
- ✅ Frontend pages, stores & i18n catalogs

### Run Backend Tests

```bash
cd backend
npm test                       # unit/route suites (no database needed)
npm run test:integration       # integration suites (requires a running MongoDB)
npm test -- --coverage         # coverage report
npm test -- sso.test.ts        # single suite
npm test -- --watch            # watch mode
```

### Run Frontend Tests

```bash
cd frontend
npm test                       # Vitest, single run
npm run test:watch             # watch mode
```

### Run E2E Tests

```bash
npm run test:e2e
```

Playwright starts its own backend, frontend, and mock identity provider — ports 3001, 5173, and 8099 must be free.

### Continuous Integration

GitHub Actions (`.github/workflows/`) runs the backend, frontend, and E2E suites plus PR checks on pushes and pull requests.

## Production Deployment

A step-by-step production runbook (Slovak) is available in [docs/DEPLOY.md](docs/DEPLOY.md).

### Using Docker Compose (Recommended)

1. **Update environment variables**
   ```bash
   cp .env.example .env
   ```

   Set production values:
   ```env
   NODE_ENV=production
   SESSION_SECRET=<your-secure-random-secret>
   MAIL_SETTINGS_KEY=<your-secure-random-key>   # 64 hex chars; required outside dev — both compose files fail fast if unset
   ADMIN_EMAIL=admin@yourdomain.com
   ADMIN_PASSWORD=<strong-admin-password>
   COOKIE_SECURE=true   # Set to true when behind HTTPS
   ```

2. **Build and deploy**
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   For local Docker (HTTP):
   ```bash
   docker compose up -d --build
   ```

3. **Access the application**
   - Application: http://localhost (via nginx)
   - Default admin: configured via `ADMIN_EMAIL` / `ADMIN_PASSWORD` in .env

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` | MongoDB root credentials — docker-compose creates the mongod user from them and composes the backend's credentialed `DATABASE_URL` | Required |
| `DATABASE_URL` | Credentialed MongoDB connection string (see `.env.example` for the exact form) | Required |
| `SESSION_SECRET` | Secret for signing session cookies | Required outside development |
| `NODE_ENV` | `development` for a host-run backend; `production` for any Docker deploy | `production` |
| `BACKEND_PORT` | Backend server port | `3001` |
| `COOKIE_SECURE` | Set `Secure` flag on cookies and switch session-cookie `SameSite` from `Lax` to `Strict` (requires HTTPS) | `false` |
| `ADMIN_EMAIL` | Bootstrap admin email — the first admin is created from these on first run | Required |
| `ADMIN_PASSWORD` | Bootstrap admin password | Required |
| `ADMIN_NAME` | Default admin display name | `Admin` |
| `FRONTEND_URL` | Frontend origin; used for CORS and the SSO post-login redirect | `http://localhost:5173` |
| `VITE_API_URL` | Frontend API base URL (build-time) | `/api` (Docker), `http://localhost:3001` (dev) |
| `MAIL_SETTINGS_KEY` | AES-256-GCM key that encrypts the stored SMTP password and the Webex bot token. 32 bytes: 64 hex chars (preferred) or base64 decoding to 32 bytes. Required outside development — the backend fails fast at boot if missing (like `SESSION_SECRET`). Everything else about the notification channels (SMTP server, from address, language, subject template, password; Webex token and language) is admin-managed at runtime on the **Email settings** / **Webex settings** pages and stored in the database | Required in production |

See [Single Sign-On (SSO)](#single-sign-on-sso) for the `SSO_*` and `BREAK_GLASS_EMAILS` variables, and [dev/MAIL-TESTING.md](dev/MAIL-TESTING.md) for the mail dev/testing story.

### Manual Deployment

1. **Backend**
   ```bash
   cd backend
   npm ci
   npm run build
   npx prisma generate
   npx prisma db push
   npm run prisma:seed
   npm start
   ```

2. **Frontend**
   ```bash
   cd frontend
   npm ci
   npm run build
   # Serve dist/ folder with nginx or similar
   ```

## Security Considerations

- **Passwords**: All passwords are hashed using bcrypt with 10 salt rounds
- **Sessions**: httpOnly cookies backed by a MongoDB session store with a 7-day TTL; `Secure` and `SameSite` follow `COOKIE_SECURE`
- **CSRF**: Custom `X-Requested-With` header required on all state-changing API requests
- **Input Validation**: All inputs validated using Zod schemas; URL params validated as MongoDB ObjectIds
- **RBAC**: Role-based access control on all protected routes
- **CSV Injection**: Report exports sanitize fields to prevent formula injection
- **Security Headers**: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy via nginx and Helmet
- **Rate Limiting**: General API limit (300 req/15min, active in production) with stricter per-endpoint limits: login 10, password change 5, SSO login 30, and idea submission 30 per 15 minutes
- **SMTP Password & Webex Bot Token**: Stored AES-256-GCM-encrypted with `MAIL_SETTINGS_KEY` and never returned by the API
- **Error Handling**: Internal server errors return generic messages to prevent information leakage
- **Session Invalidation**: Sessions are invalidated when user role or email is changed by admin
- **Admin Protection**: Admins cannot delete their own account or change their own role
- **Graceful Shutdown**: Server handles SIGTERM/SIGINT for clean disconnection

## Single Sign-On (SSO)

IdeaHub can delegate authentication to a corporate identity provider (IAM) over
**OpenID Connect** using the **authorization-code flow with PKCE**. SSO is
**disabled by default** and is enabled per-deployment with `SSO_ENABLED=true`.

### Running with and without SSO

SSO is **entirely optional** — the `SSO_*` variables are read only when
`SSO_ENABLED=true`. The whole block below can be ignored for a classic
password-only deployment.

**Without SSO (default).** With `SSO_ENABLED` unset or `"false"`, IdeaHub behaves
classically: **email + password login only**. The first admin is bootstrapped
from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` on first run, and admins
create/manage users through the user API. **No other `SSO_*` variable is needed.**

**With SSO (`SSO_ENABLED=true`).** Also set the **required** variables
`SSO_ISSUER_URL`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_REDIRECT_URI`. The
remaining variables (`SSO_SCOPE`, `SSO_ROLES_CLAIM`, `SSO_ORG_CLAIM`,
`SSO_EMAIL_CLAIM`, `SSO_NAME_CLAIM`, `SSO_ROLE_MAP`,
`SSO_POST_LOGOUT_REDIRECT_URI`, `BREAK_GLASS_EMAILS`) are **optional and have
defaults** — see the [Configuration](#configuration) table below for each.

**Required in both modes:** `FRONTEND_URL` must be set correctly (it drives CORS
and, under SSO, the post-login / logout redirect targets). The MongoDB
credentials (`MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` and the credentialed
`DATABASE_URL`) are likewise required in both modes — database authentication is
orthogonal to SSO.

**Behavior deltas when SSO is on:**

- The login page shows a primary **"Sign in with SSO"** button; the local
  email/password form is hidden behind a **"Use a local account"** toggle.
- SSO users are **just-in-time provisioned**, and their **role and department are
  re-synced from the ID-token claims on every login** (the IAM is the source of
  truth).
- SSO users have **no logout button and no "Change Password"** navigation in the
  app — those sessions are **IAM-owned** (logout is RP-initiated at the IdP;
  passwords live in the IAM). Set `SSO_SHOW_LOGOUT=true` to re-expose the
  logout button for SSO users; it then performs RP-initiated logout at the IdP.
- Admins **cannot edit SSO-managed users** (name / email / role / password) via
  the user API.
- **Break-glass** local accounts (`BREAK_GLASS_EMAILS`, default `[ADMIN_EMAIL]`)
  always keep password login and can **never** be converted to SSO, so an IAM
  outage can never lock every administrator out.

**Testing & onboarding (linked, not duplicated):**

- Local, click-through SSO testing with a preconfigured Keycloak kit:
  [dev/SSO-TESTING.md](dev/SSO-TESTING.md).
- Production IAM onboarding and what to request from the security team:
  [dev/IAM-REQUEST.md](dev/IAM-REQUEST.md).

### How it works

1. The frontend calls `GET /api/auth/config` and shows a "Sign in with SSO"
   button when `ssoEnabled` is `true`.
2. `GET /api/auth/sso/login` performs OIDC discovery against the issuer,
   generates `state`, `nonce`, and a PKCE `code_verifier`/`code_challenge`, and
   redirects the browser to the IAM authorization endpoint.
3. The OIDC transaction (`state`/`nonce`/`code_verifier`) is stored in a
   dedicated, HMAC-signed, `SameSite=Lax` cookie (`sso_txn`) scoped to
   `/api/auth/sso`. This is required because the main session cookie is
   `SameSite=Strict` and is not sent on the cross-site redirect back from the
   IAM. The cookie is signed with `SESSION_SECRET` and expires after 10 minutes.
4. `GET /api/auth/sso/callback` verifies the transaction cookie, exchanges the
   code (validating `state`, `nonce`, and PKCE), then reads the user's claims:
   the ID-token claims are **merged with the userinfo response** when the
   issuer advertises a userinfo endpoint (ID-token values win on conflict —
   they are signature-verified; a userinfo failure fails the login rather than
   proceeding with partial claims). This supports IdPs whose ID tokens carry
   only `sub` and release profile/role claims solely via userinfo. The user is
   then **just-in-time provisioned** or updated and a fresh session starts.
   Any failure redirects to `${FRONTEND_URL}/login?error=sso_failed` with no
   detail leaked to the browser. The session additionally retains the ID token
   (server-side only) for use as `id_token_hint` at logout.
5. `POST /api/auth/logout` first destroys the local session and clears its
   cookie. For SSO sessions it then performs **RP-initiated logout**: it responds
   with `{ message, redirectTo }`, where `redirectTo` is the issuer's
   `end_session_endpoint` composed with `id_token_hint` and
   `post_logout_redirect_uri` (`SSO_POST_LOGOUT_REDIRECT_URI`). The frontend does
   a full-page navigation to it, so the IAM also ends its session and the next
   "Sign in with SSO" re-prompts for credentials. If SSO is disabled, the session
   was local, the issuer advertises no `end_session_endpoint`, or discovery
   fails, logout stays purely local (no `redirectTo`) — the local logout has
   already succeeded, so IdP logout is best-effort and never blocks it. The ID
   token is never logged and never sent to the browser except inside `redirectTo`.

Identity is keyed on the ID-token `sub` claim. If no user matches the `sub` but
a local account with the same email exists, that account is **linked** to SSO
(its local password is removed). Otherwise a new SSO user is created. On every
SSO login the user's name, role, and department are re-provisioned from the IdP
(the IAM is the source of truth), so SSO-managed users cannot be edited locally
via the admin user API.

### Break-glass local login

Local password login always remains available for the accounts listed in
`BREAK_GLASS_EMAILS` (defaults to `[ADMIN_EMAIL]`). Those emails are **refused**
if they attempt to log in through SSO — this guarantees an IdP outage or
misconfiguration can never lock every administrator out. Keep at least one
break-glass admin with a strong local password.

### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `SSO_ENABLED` | Master switch (`true` to enable SSO) | `false` |
| `SSO_ISSUER_URL` | OIDC issuer URL (discovery base) | — |
| `SSO_CLIENT_ID` | Client ID issued by the IAM | — |
| `SSO_CLIENT_SECRET` | Client secret issued by the IAM | — |
| `SSO_REDIRECT_URI` | Callback URI — `{BASE_URL}/api/auth/sso/callback` | — |
| `SSO_POST_LOGOUT_REDIRECT_URI` | Where the IAM returns the browser after RP-initiated logout (must be registered with the IAM) | `${FRONTEND_URL}/login` |
| `SSO_SHOW_LOGOUT` | Show the in-app logout button for SSO users (triggers RP-initiated logout) | `false` |
| `SSO_SCOPE` | Requested scopes | `openid profile email` |
| `SSO_ROLES_CLAIM` | Claim holding IAM roles (ID token or userinfo; e.g. `diam:roles`) | `roles` |
| `SSO_ORG_CLAIM` | Claim holding org/department (ID token or userinfo) | `org` |
| `SSO_EMAIL_CLAIM` | Claim holding email (ID token or userinfo) | `email` |
| `SSO_NAME_CLAIM` | Claim holding display name (ID token or userinfo) | `name` |
| `SSO_ROLE_MAP` | `iam-role:APP_ROLE,...` mapping (app role ∈ `USER`/`POWER_USER`/`ADMIN`) | — |
| `BREAK_GLASS_EMAILS` | Emails forbidden from SSO (csv, lowercased) | `[ADMIN_EMAIL]` |
| `SSO_PRUNE_INTERVAL_HOURS` | Hours between prunes of orphaned SSO users (no session, no ideas, no events) | `24` |

Role mapping keys are matched case-insensitively and the **highest-privilege**
match wins; an IdP role with no mapping resolves to `USER`. Example:

```env
SSO_ROLE_MAP="idea-hub-admins:ADMIN,idea-hub-reviewers:POWER_USER,idea-hub-users:USER"
```

### IAM client registration request

Provide the following to your IAM / identity team when requesting an OIDC client:

- **Application name**: IdeaHub
- **Flow / grant type**: Authorization Code with PKCE (`response_type=code`)
- **Redirect URI**: `{BASE_URL}/api/auth/sso/callback`
  (e.g. `https://ideahub.example.com/api/auth/sso/callback`)
- **Scopes**: `openid profile email`
- **Required claims** (in the ID token or the userinfo response):
  - `sub` — stable unique subject identifier (used as the SSO key; must be in
    the ID token)
  - `email` — user email
  - `name` — display name
  - `roles` — group/role names to map to app roles (e.g. `idea-hub-admins`,
    `idea-hub-reviewers`, `idea-hub-users` — must match `SSO_ROLE_MAP`)
  - `org` — organizational unit / department (optional)
- **Return**: `client_id` and `client_secret` for the `SSO_*` variables above.

## Troubleshooting

### MongoDB Connection Issues

If you see "MongoNetworkError" or connection refused:
1. Ensure MongoDB is running: `docker-compose ps`
2. Check MongoDB logs: `docker-compose logs mongodb`
3. Verify DATABASE_URL in .env

### Port Already in Use

If ports 80, 3001, or 27017 are in use:
1. Stop conflicting services
2. Or change ports in docker-compose.yml and .env

### Prisma Client Issues

If you see "Prisma Client not generated":
```bash
cd backend
npm run prisma:generate
```

### Frontend API Connection

If frontend can't reach backend:
1. Check VITE_API_URL in .env
2. Ensure backend is running
3. Check browser console for CORS errors

## Support

For issues and questions:
- Create an issue in the repository
- Check existing documentation
- Review API endpoint examples

## Acknowledgments

- Built with Vue 3, Vuetify, Express, and Prisma
- Chart.js for analytics visualization
- MongoDB for flexible data storage
- Docker for containerization
