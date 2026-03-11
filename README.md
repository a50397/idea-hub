# IdeaHub

A modern web application for managing internal improvement ideas, designed for employees to submit, review, approve, execute, and track ideas within an organization.

## Features

### Core Functionality
- **Idea Submission**: Employees can submit improvement ideas with title, description, benefits, effort estimation, and tags
- **Review & Approval**: Power users and admins can review, approve, or reject submitted ideas
- **Idea Execution**: Approved ideas can be claimed and worked on by any user
- **Completion Tracking**: Users can mark their claimed ideas as completed
- **Activity Timeline**: Full audit trail of all actions taken on each idea

### Dashboard & Analytics
- Real-time statistics (submitted, approved, in-progress, done, rejected)
- Monthly trend charts showing completed ideas over time
- Average time metrics (submission to approval, approval to completion)
- Top contributors leaderboard

### Reporting
- Advanced filtering (status, date range, submitter, assignee, tags)
- CSV export functionality for data analysis
- Comprehensive reporting interface

### User Management (Admin Only)
- Create, edit, and delete users
- Role-based access control (User, Power User, Admin)
- User statistics (submitted ideas, assigned ideas)

### Security & Authentication
- Session-based authentication with bcrypt password hashing
- Role-based access control (RBAC)
- CSRF protection via custom header validation
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Input validation using Zod with ObjectId format enforcement
- Protection against CSV injection in report exports
- Session invalidation on role/email changes
- Graceful server shutdown (SIGTERM/SIGINT)
- Admin self-protection (cannot delete own account or change own role)
- Rate limiting on API and login endpoints

## Tech Stack

### Backend
- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Database**: MongoDB with Prisma ORM
- **Authentication**: express-session with bcrypt
- **Validation**: Zod
- **Testing**: Jest + Supertest

### Frontend
- **Framework**: Vue 3 (Composition API)
- **UI Library**: Vuetify 3
- **State Management**: Pinia
- **Routing**: Vue Router
- **Charts**: Chart.js with vue-chartjs
- **HTTP Client**: Axios
- **Build Tool**: Vite

### DevOps
- **Containerization**: Docker & Docker Compose
- **Reverse Proxy**: Nginx (for frontend in production)

## Project Structure

```
idea-hub/
├── backend/                 # Express.js backend
│   ├── prisma/
│   │   ├── schema.prisma   # Database schema
│   │   └── seed.ts         # Database seeding script
│   ├── src/
│   │   ├── __tests__/      # Jest tests
│   │   ├── middleware/     # Auth & RBAC middleware
│   │   ├── routes/         # API routes
│   │   ├── types/          # TypeScript types
│   │   ├── utils/          # Validation schemas
│   │   └── index.ts        # Server entry point
│   ├── Dockerfile
│   └── package.json
├── frontend/               # Vue 3 frontend
│   ├── src/
│   │   ├── api/           # API client modules
│   │   ├── components/    # Reusable components
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
├── docker-compose.yml
├── .env.example
└── README.md
```

## Prerequisites

- **Node.js** 20.x or higher
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
   DATABASE_URL="mongodb://mongodb:27017/ideahub"
   SESSION_SECRET="your-super-secret-session-key-change-in-production"
   NODE_ENV="production"
   BACKEND_PORT=3001
   VITE_API_URL="http://localhost:3001"
   ```

3. **Build and start containers**
   ```bash
   docker-compose up -d
   ```

4. **Seed the database** (first time only)
   ```bash
   docker-compose exec backend npm run prisma:seed
   ```

5. **Access the application**
   - Frontend: http://localhost
   - Backend API: http://localhost:3001
   - MongoDB: localhost:27017

6. **Login with demo accounts**
   - **Admin**: admin@ideahub.com / admin123
   - **Power User**: power@ideahub.com / power123
   - **User**: john@ideahub.com / user123

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
npm run dev              # Start both backend and frontend in dev mode
npm run build            # Build both backend and frontend
npm run test             # Run backend tests
npm run docker:build     # Build Docker images
npm run docker:up        # Start Docker containers
npm run docker:down      # Stop Docker containers
```

### Backend

```bash
npm run dev              # Start development server with hot reload
npm run build            # Compile TypeScript to JavaScript
npm run start            # Start production server
npm run test             # Run Jest tests
npm run prisma:generate  # Generate Prisma Client
npm run prisma:migrate   # Run database migrations
npm run prisma:seed      # Seed database with test data
npm run prisma:studio    # Open Prisma Studio (database GUI)
```

### Frontend

```bash
npm run dev              # Start Vite dev server
npm run build            # Build for production
npm run preview          # Preview production build
```

## API Documentation

### Authentication Endpoints

- `POST /api/auth/login` - Login with email and password
- `POST /api/auth/logout` - Logout current user
- `GET /api/auth/me` - Get current user info

### Ideas Endpoints

- `GET /api/ideas` - Get all ideas (with optional filters)
- `GET /api/ideas/:id` - Get single idea with events
- `POST /api/ideas` - Create new idea
- `PATCH /api/ideas/:id` - Update idea (submitter only)
- `PATCH /api/ideas/:id/approve` - Approve idea (Power User/Admin)
- `PATCH /api/ideas/:id/reject` - Reject idea (Power User/Admin)
- `PATCH /api/ideas/:id/claim` - Claim and start working on idea
- `PATCH /api/ideas/:id/complete` - Mark idea as completed
- `DELETE /api/ideas/:id` - Delete idea (Admin only)
- `POST /api/ideas/:id/steps` - Add progress step to in-progress idea

### Reports Endpoints

- `GET /api/reports/summary` - Get dashboard summary statistics
- `GET /api/reports/monthly-trend` - Get monthly completion trend
- `GET /api/reports/top-contributors` - Get top contributors
- `GET /api/reports/filtered` - Get filtered ideas (with CSV export)

### Users Endpoints (Admin Only)

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get single user
- `POST /api/users` - Create new user
- `PATCH /api/users/:id` - Update user (cannot change own role)
- `DELETE /api/users/:id` - Delete user (cannot delete self)

## User Roles & Permissions

### USER
- Submit new ideas
- View all ideas (global list and own ideas)
- Claim approved ideas for execution
- Mark claimed ideas as completed

### POWER_USER
- All USER permissions
- Access to review queue
- Approve or reject submitted ideas
- Request changes on ideas

### ADMIN
- All POWER_USER permissions
- Manage users (create, edit, delete, change roles)
- Access to user management interface

## Database Schema

### User Model
- `id`: Unique identifier
- `name`: User's full name
- `email`: Unique email address
- `passwordHash`: Bcrypt hashed password
- `role`: USER | POWER_USER | ADMIN
- `createdAt`, `updatedAt`: Timestamps

### Idea Model
- `id`: Unique identifier
- `title`: Idea title (5-120 chars)
- `description`: Detailed description
- `benefits`: Expected benefits
- `effort`: Effort estimation (< 1 day, 1-3 days, > 3 days)
- `status`: SUBMITTED | APPROVED | IN_PROGRESS | DONE | REJECTED
- `tags`: Array of tag strings
- `submitterId`: User who submitted
- `approverId`: User who approved (nullable)
- `assigneeId`: User working on it (nullable)
- `submittedAt`, `approvedAt`, `startedAt`, `completedAt`: Timestamps

### IdeaEvent Model
- `id`: Unique identifier
- `ideaId`: Related idea
- `type`: Event type (SUBMITTED, APPROVED, REJECTED, etc.)
- `byUserId`: User who performed action
- `timestamp`: When event occurred
- `note`: Optional note/comment

## Testing

IdeaHub has **comprehensive test coverage** across backend and frontend.

### Test Coverage Summary

- **Backend Tests**: 184 test cases across 7 suites
- **Frontend Tests**: 265 test cases (i18n)
- **Total**: 449 tests
- **Test Files**: 7 backend (auth, ideas, reports, users, integration, validation, init-admin) + 1 frontend

**What's Tested:**
- ✅ Authentication & session management (23 tests)
- ✅ Ideas CRUD & workflows (35 tests)
- ✅ Reports & analytics (15 tests)
- ✅ User management (20 tests)
- ✅ Integration workflows (10 tests)
- ✅ Validation schemas (30+ tests)
- ✅ Admin initialization (10+ tests)
- ✅ RBAC enforcement
- ✅ Error handling & edge cases
- ✅ Frontend i18n (265 tests)

See [backend/TEST_COVERAGE.md](backend/TEST_COVERAGE.md) for detailed coverage report.

### Run Backend Tests

```bash
cd backend
npm test
```

### Test Coverage Report

```bash
cd backend
npm test -- --coverage
```

### Run Specific Test Suite

```bash
npm test auth.test.ts          # Authentication tests
npm test ideas.test.ts         # Ideas CRUD & workflow tests
npm test reports.test.ts       # Reports & analytics tests
npm test users.test.ts         # User management tests
npm test integration.test.ts   # End-to-end workflows
npm test validation.test.ts    # Validation schema tests
```

### Watch Mode (Development)

```bash
npm test -- --watch
```

## Production Deployment

### Using Docker Compose (Recommended)

1. **Update environment variables**
   ```bash
   cp .env.example .env
   ```

   Set production values:
   ```env
   NODE_ENV=production
   SESSION_SECRET=<your-secure-random-secret>
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
| `DATABASE_URL` | MongoDB connection string | `mongodb://mongodb:27017/ideahub` |
| `SESSION_SECRET` | Secret for signing session cookies | Required in production |
| `NODE_ENV` | Environment mode | `production` |
| `BACKEND_PORT` | Backend server port | `3001` |
| `COOKIE_SECURE` | Set `Secure` flag on cookies (requires HTTPS) | `false` |
| `ADMIN_EMAIL` | Default admin email | `admin@ideahub.com` |
| `ADMIN_PASSWORD` | Default admin password | `admin123` |
| `ADMIN_NAME` | Default admin display name | `Admin` |
| `VITE_API_URL` | Frontend API base URL (build-time) | `/api` (Docker), `http://localhost:3001` (dev) |

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
- **Sessions**: Secure session cookies with httpOnly flag; configurable `Secure` and `SameSite` attributes
- **CSRF**: Custom `X-Requested-With` header required on all state-changing API requests
- **Input Validation**: All inputs validated using Zod schemas; URL params validated as MongoDB ObjectIds
- **RBAC**: Role-based access control on all protected routes
- **CSV Injection**: Report exports sanitize fields to prevent formula injection
- **Security Headers**: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy via nginx and Helmet
- **Rate Limiting**: General API rate limit (100 req/15min) and login rate limit (10 req/15min)
- **Error Handling**: Internal server errors return generic messages to prevent information leakage
- **Session Invalidation**: Sessions are invalidated when user role or email is changed by admin
- **Admin Protection**: Admins cannot delete their own account or change their own role
- **Graceful Shutdown**: Server handles SIGTERM/SIGINT for clean disconnection

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

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

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
