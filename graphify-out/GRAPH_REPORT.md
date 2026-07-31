# Graph Report - idea-hub  (2026-07-30)

## Corpus Check
- 117 files · ~119,748 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 291 nodes · 392 edges · 65 communities (64 shown, 1 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8693d24a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]

## God Nodes (most connected - your core abstractions)
1. `createTestVuetify()` - 17 edges
2. `createUser()` - 17 edges
3. `newAgent()` - 14 edges
4. `loginAs()` - 14 edges
5. `resetDb()` - 13 edges
6. `waitForBoot()` - 11 edges
7. `createTestI18n()` - 9 edges
8. `getEffectiveMailConfig()` - 9 edges
9. `withCsrf()` - 8 edges
10. `storageStatePath()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `mountPage()` --calls--> `createTestVuetify()`  [INFERRED]
  frontend/src/__tests__/DepartmentsPage.test.ts → frontend/src/__tests__/helpers.ts
- `mountPage()` --calls--> `createTestVuetify()`  [INFERRED]
  frontend/src/__tests__/SubmitIdeaPage.test.ts → frontend/src/__tests__/helpers.ts
- `mountCard()` --calls--> `createTestVuetify()`  [INFERRED]
  frontend/src/__tests__/IdeaCard.test.ts → frontend/src/__tests__/helpers.ts
- `mountPage()` --calls--> `createTestVuetify()`  [INFERRED]
  frontend/src/__tests__/MailSettingsPage.test.ts → frontend/src/__tests__/helpers.ts
- `mountPage()` --calls--> `createTestVuetify()`  [INFERRED]
  frontend/src/__tests__/UsersPage.test.ts → frontend/src/__tests__/helpers.ts

## Communities (65 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (16): clickByText(), createTestI18n(), createTestVuetify(), findByText(), mountCard(), mountLogin(), fieldByLabel(), mountPage() (+8 more)

### Community 1 - "Community 1"
Cohesion: 0.18
Nodes (21): loggedInAdmin(), seedActors(), loggedInAdmin(), createSsoUser(), authorize(), httpGetLocation(), ssoLogin(), seedTargetAndAdmin() (+13 more)

### Community 2 - "Community 2"
Cohesion: 0.13
Nodes (18): getBreakGlassEmails(), getRoleMap(), getSsoConfig(), isAppRole(), isSsoEnabled(), isSsoLogoutVisible(), mapRolesToAppRole(), b64url() (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (9): createDepartment(), dialog(), authenticate(), storageStatePath(), drawer(), loginViaUi(), logoutViaUi(), navItem() (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (8): getEffectiveMailConfig(), getMailSettingsRecord(), normalizeLang(), mapMailFailure(), sanitizeSubject(), sendMail(), sendTestMail(), systemErrorName()

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (4): requireAuth(), requireRole(), interpolate(), newIdeaEmail()

### Community 6 - "Community 6"
Cohesion: 0.19
Nodes (5): comboboxInput(), editCombobox(), mountPage(), setEditEmails(), typeInEmails()

### Community 7 - "Community 7"
Cohesion: 0.22
Nodes (5): ensureAdminExists(), ensureDepartments(), pruneCandidateChunk(), pruneOrphanSsoUsers(), userIdsWithSession()

### Community 8 - "Community 8"
Cohesion: 0.52
Nodes (6): applySettings(), notify(), save(), sendTest(), showTestResult(), validate()

### Community 9 - "Community 9"
Cohesion: 0.43
Nodes (4): authorize(), httpGetLocation(), provisionWithOrg(), provisionWithRoles()

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `requireAuth()` connect `Community 5` to `Community 2`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `createTestVuetify()` connect `Community 0` to `Community 6`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `getEffectiveMailConfig()` connect `Community 4` to `Community 5`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `createTestVuetify()` (e.g. with `mountPage()` and `mountCard()`) actually correct?**
  _`createTestVuetify()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `createUser()` (e.g. with `createSsoUser()` and `loggedInAdmin()`) actually correct?**
  _`createUser()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `newAgent()` (e.g. with `loggedInAdmin()` and `loggedInAdmin()`) actually correct?**
  _`newAgent()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `loginAs()` (e.g. with `loggedInAdmin()` and `loggedInAdmin()`) actually correct?**
  _`loginAs()` has 4 INFERRED edges - model-reasoned connections that need verification._