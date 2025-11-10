# Branch Protection Setup Guide

This guide explains how to configure branch protection rules to enforce pre-merge testing.

## Quick Setup

### 1. Navigate to Branch Protection Settings

1. Go to your repository on GitHub
2. Click **Settings** (top navigation)
3. Click **Branches** (left sidebar)
4. Click **Add branch protection rule** or **Add rule**

### 2. Configure Branch Pattern

**Branch name pattern:** `main`

If your primary branch is named `master` or something else, use that instead.

### 3. Required Settings

#### Pull Request Requirements
✅ **Require a pull request before merging**
- Minimum: 1 required approving review
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ⬜ Require review from Code Owners (optional)

#### Status Check Requirements
✅ **Require status checks to pass before merging**

Add these required status checks:
- `Backend Tests`
- `Frontend Build`
- `Lint Code`
- `Docker Build Test`
- `All Checks Passed`

✅ **Require branches to be up to date before merging**
- This ensures branches are tested with the latest main branch code

#### Conversation Requirements
✅ **Require conversation resolution before merging**
- All review comments must be resolved

#### Additional Protection
✅ **Do not allow bypassing the above settings**
- Enforces rules for administrators too

### 4. Optional but Recommended Settings

✅ **Require linear history**
- Prevents merge commits, keeps history clean
- Only rebase and squash merges allowed

✅ **Require deployments to succeed before merging**
- If you have deployment previews configured

⬜ **Lock branch**
- Use this for production branches that should rarely change

✅ **Restrict who can push to matching branches**
- Limit direct pushes to specific users/teams
- Most developers will use PRs instead

### 5. Save Rules

Click **Create** or **Save changes**

## Testing the Setup

1. Create a new branch:
   ```bash
   git checkout -b test-branch-protection
   ```

2. Make a small change and push:
   ```bash
   echo "# Test" >> test.md
   git add test.md
   git commit -m "test: verify branch protection"
   git push origin test-branch-protection
   ```

3. Create a Pull Request on GitHub

4. Verify that:
   - ✅ Workflows start automatically
   - ✅ You cannot merge until checks pass
   - ✅ Merge button is disabled if checks fail

## Workflow Status Checks

### Backend Tests
- Runs all Jest unit and integration tests
- Generates Prisma client
- Builds TypeScript code
- **Pass criteria:** All tests pass, no build errors

### Frontend Build
- Installs dependencies
- Builds production bundle with Vite
- **Pass criteria:** Build completes without errors

### Lint Code
- TypeScript type checking for backend
- TypeScript type checking for frontend
- **Pass criteria:** No TypeScript errors

### Docker Build Test
- Builds backend Docker image
- Builds frontend Docker image
- Uses layer caching for faster builds
- **Pass criteria:** Both images build successfully

### All Checks Passed (PR Checks)
- Validates PR title format
- Summary check that all required checks succeeded
- **Pass criteria:** PR title follows conventional commits format

## Troubleshooting

### "Required status check is not in the list of checks"

**Problem:** GitHub doesn't show the check name in the dropdown

**Solution:**
1. Create and push a test PR first
2. Wait for workflows to run
3. Then configure branch protection
4. GitHub will now show the check names

### Checks not running

**Problem:** Workflows don't trigger on PR

**Solution:**
1. Check workflow files are in `.github/workflows/`
2. Verify YAML syntax is valid
3. Ensure PR targets a branch specified in workflow triggers
4. Check Actions are enabled: **Settings → Actions → General**

### Direct pushes still work

**Problem:** Can push directly to main branch

**Solution:**
- Enable "Do not allow bypassing the above settings"
- Add "Restrict who can push to matching branches"
- Ensure you saved the branch protection rule

## Advanced Configuration

### Different rules for different branches

Create separate rules for:
- `main` - Strict rules, require all checks
- `develop` - Moderate rules, require tests only
- `release/*` - Very strict, require additional approvals

### Auto-merge when checks pass

Enable **Allow auto-merge** in:
- **Settings → General → Pull Requests**
- Users can then click "Enable auto-merge" on PRs
- PR merges automatically when all checks pass

### Required reviewers by code area

Create a `CODEOWNERS` file:

```
# Backend changes require backend team review
/backend/ @your-org/backend-team

# Frontend changes require frontend team review
/frontend/ @your-org/frontend-team

# Infrastructure changes require DevOps review
/docker-compose.yml @your-org/devops-team
/.github/ @your-org/devops-team
```

## Monitoring

### View workflow runs
- **Actions** tab in repository
- See all workflow runs, logs, and timing

### Check protection status
- **Insights → Community → Branch protection**
- Shows which branches have protection rules

### Audit log
- **Settings → Audit log**
- See who changed branch protection settings

## Resources

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Status Checks Documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)
- [CODEOWNERS Documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
