# GitHub Actions Workflows

This directory contains automated workflows for the IdeaHub project.

## Workflows

### 1. Tests (`test.yml`)
**Trigger:** Push to main/master/develop branches or Pull Requests targeting these branches

**Jobs:**
- **Backend Tests**: Runs Jest tests for the backend
- **Frontend Build**: Builds the frontend to ensure no build errors
- **Lint**: TypeScript type checking for both frontend and backend
- **Docker Build**: Validates Docker images can be built successfully

**Requirements:**
- Node.js 20.x
- All dependencies installed via `npm ci`
- Prisma client generated for backend tests

### 2. PR Checks (`pr-checks.yml`)
**Trigger:** Pull Request events (opened, synchronized, reopened, ready for review)

**Jobs:**
- **PR Metadata Check**: Validates PR title follows conventional commit format
- **All Checks Pass**: Summary job that ensures all required checks pass

**Conventional Commit Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test updates
- `build`: Build system changes
- `ci`: CI/CD changes
- `chore`: Other changes (maintenance, etc.)
- `revert`: Revert previous changes

**Example PR Titles:**
- ✅ `feat: add user authentication`
- ✅ `fix: resolve login redirect issue`
- ✅ `docs: update API documentation`
- ❌ `updated login page` (missing type)
- ❌ `Fix bug` (type should be lowercase)

## Setting Up Branch Protection

To enforce these checks before merging, configure branch protection rules:

1. Go to **Settings** → **Branches** → **Add branch protection rule**
2. Branch name pattern: `main` (or `master`)
3. Enable the following options:
   - ✅ **Require a pull request before merging**
   - ✅ **Require status checks to pass before merging**
     - Add required status checks:
       - `Backend Tests`
       - `Frontend Build`
       - `Lint Code`
       - `Docker Build Test`
       - `All Checks Passed`
   - ✅ **Require branches to be up to date before merging**
   - ✅ **Require conversation resolution before merging**
   - ✅ **Do not allow bypassing the above settings**

4. **(Optional)** Additional settings:
   - ✅ **Require linear history**
   - ✅ **Require deployments to succeed before merging**
   - ✅ **Lock branch** (for production branches)

## Running Tests Locally

Before pushing your changes, run these commands locally:

```bash
# Backend tests
cd backend
npm test

# Backend build
npm run build

# Frontend build
cd ../frontend
npm run build

# TypeScript checks
npx tsc --noEmit

# Run all Docker builds
cd ..
docker compose build
```

## Troubleshooting

### Tests Failing in CI but Passing Locally

1. **Check Node version**: CI uses Node 20.x
2. **Clean install**: Use `npm ci` instead of `npm install`
3. **Environment variables**: Ensure test environment variables are set
4. **Database setup**: Tests use mocked Prisma client

### Docker Build Failures

1. **Check .dockerignore**: Ensure compiled files are excluded
2. **Dependencies**: Verify all dependencies are in package.json
3. **Build context**: Review Dockerfile COPY commands
4. **Multi-stage builds**: Ensure all stages complete successfully

### PR Title Validation Errors

Ensure your PR title follows the format: `type: description`

Examples:
- `feat: add dark mode support`
- `fix: resolve memory leak in dashboard`
- `docs: update installation guide`

## Badge for README

Add this to your main README.md to show build status:

```markdown
[![Tests](https://github.com/YOUR_USERNAME/idea-hub/actions/workflows/test.yml/badge.svg)](https://github.com/YOUR_USERNAME/idea-hub/actions/workflows/test.yml)
```

Replace `YOUR_USERNAME` with your GitHub username or organization name.
