Build a Web Application “IdeaHub”

Goal
Create a modern web application called “IdeaHub”, designed for employees to submit internal improvement ideas, review and approve them, execute selected ideas, and generate reports.
The app must include login with username and password, simple forms, and a clean dashboard. Data should be stored in MongoDB (or another suitable database, but MongoDB is preferred).

Recommended Tech Stack
(You can adjust if needed, but keep equivalent functionality.)
Frontend: Vue, Vuetify, Vue Hook Form + Zod validation
Auth: NextAuth with Credentials provider (username/password), bcrypt password hashing
Database: Prisma + MongoDB (Mongoose is also acceptable)
API: vue router (REST)
Design: Simple, modern, responsive, clean typography (light theme)
Charts: Recharts for analytics
Tests: Basic API smoke tests (Jest)
Containerization: Dockerfile + docker-compose.yml (app + MongoDB)
Deployment: Include npm scripts and a README with instructions

User Roles and Permissions (RBAC)
Role Capabilities
User - Submit new ideas, view their own ideas and global list, “claim” approved ideas for execution, mark their idea as completed.
PowerUser - Everything above + access to the review queue. Can approve, reject, or request changes.
Admin - Everything above + manage users (create, edit roles) and access global settings.

Data Model (Prisma Schema Example)

User
id (string, cuid)
name (string)
email (string, unique)
passwordHash (string)
role (enum: USER, POWER_USER, ADMIN)
createdAt, updatedAt

Idea
id (string, cuid)
title (string, 5–120 chars)
description (string, up to ~3000 chars)
benefits (string or markdown)
effort (enum or string: “<1 day”, “1–3 days”, “>3 days”)
status (enum: SUBMITTED, APPROVED, IN_PROGRESS, DONE, REJECTED)
submitterId (FK → User)
approverId (FK → User, nullable)
assigneeId (FK → User, nullable)
submittedAt, approvedAt, startedAt, completedAt (datetimes)
tags (string[], optional)

IdeaEvent (optional audit log)
id, ideaId, type (SUBMITTED / APPROVED / REJECTED / CLAIMED / STARTED / COMPLETED / UPDATED), byUserId, timestamp, note

Functionality Overview
1) Authentication
Login via username or email + password
Registration allowed only by Admin
Store passwords hashed with bcrypt
Enable logout and “remember me” sessions
2) Idea Submission (User)
Page New Idea with form: title, description, benefits, effort
Automatically store submitterId and submittedAt = now()
Default status = SUBMITTED
Validation: title (required), effort (required), non-empty description and benefits
3) Idea Review (PowerUser)
Page Review Queue showing all SUBMITTED ideas
Actions: Approve, Reject, Request Changes (with optional comment)
On approval → set status = APPROVED, approvedAt = now(), approverId = currentUser
Log all changes in IdeaEvent
4) Approved Ideas and “Pick & Play”
Page Approved Ideas lists all APPROVED items
Any user can click Claim / Start, which sets:
assigneeId = currentUser
status = IN_PROGRESS
startedAt = now()
Display assigned user’s name and start date
5) Completing an Idea
The assigned user can mark their idea as Completed
Updates:
status = DONE
completedAt = now()
The idea then moves to the Completed section
6) Dashboard
Page Dashboard displaying cards and charts:
Counts of SUBMITTED / APPROVED / IN_PROGRESS / DONE
Monthly trend of completed ideas
Average time between SUBMITTED → APPROVED and APPROVED → DONE
Top Contributors (ranking by completed ideas)
7) Reporting
Page Reports with filters (date range, status, user, tags, effort)
Show table + charts (Recharts)
Export to CSV: id, title, status, duration, author, assignee, timestamps
8) Notifications & Scheduled Tasks
Weekly cron job: notify PowerUsers about the number of pending ideas
On approval: send notification/email to the submitter
For development: logging to console is fine

UI and Navigation

Sidebar layout with sections:
Dashboard
Submit Idea
Approved
In Progress
Completed
Review (PowerUser only)
Reports
Users (Admin only)
Use shadcn/ui or similar components (Button, Card, Table, Badge, Dialog, Tabs)
Minimalist look, one primary color, readable layout
🔌 API Endpoints (example)
POST   /api/auth/login
POST   /api/ideas                // submit new idea
GET    /api/ideas?status=...     // filtered list
PATCH  /api/ideas/:id/approve    // PowerUser only
PATCH  /api/ideas/:id/reject     // PowerUser only
PATCH  /api/ideas/:id/claim      // mark as IN_PROGRESS
PATCH  /api/ideas/:id/complete   // mark as DONE
GET    /api/reports/summary      // for dashboard + reporting

Security
Enforce role checks on all server actions
Validate ownership before claiming or completing ideas
Input validation using Zod
Sanitize all user input
Use HTTPS and secure cookies in production
Database Seeding and Migrations
Prisma migrations for User, Idea, and IdeaEvent
Seed script:
Create admin, one power user, several test users
Add a few demo ideas in different states
Testing
Jest tests for API:
Auth flow
Create → Approve → Claim → Complete workflow
One integration test for full happy path
Docker & Local Setup
docker-compose.yml includes app + MongoDB
Dockerfile for Node 20+ runtime
README instructions:
Local setup (development)
Production build & deployment
Required .env variables (DATABASE_URL, NEXTAUTH_SECRET, etc.)
Acceptance Criteria
Login works and roles are enforced
New ideas are stored with submitter ID
PowerUser can review and approve/reject
Approved ideas can be claimed by users
Completion updates status and timestamp
Dashboard displays idea stats and charts
Reporting supports filtering and CSV export
Basic audit trail (IdeaEvent) is logged
App runs locally via docker-compose
Codebase uses TypeScript, Prettier formatting, clear structure
Please generate the complete project, including:
Frontend and backend code
Database schema and seed
API route handlers
UI components and pages
Tests
Docker configuration
README with setup instructions
Design: clean, modern, intuitive.
