# Team-Level Skill Configuration Plan

> Status: partially implemented. Phases 1–3 of §10 are live: the renderer client
> (`src/lib/team-skills-client.ts`), the `useTeamSkills` hook, the SkillsRoute team tab, the
> composer palette merge, and the per-turn system prompt via `buildTeamSkillsSystem`. The live
> Registry only supports "associating a whole package with a team": reads use the team's
> `package-infos`, add and remove use the package ↔ team association endpoints. The per-Skill
> `org-control` model in §4 below remains a future evolution — the client must not call its PATCH,
> per-Skill DELETE, or reorder endpoints, and must not offer per-Skill enable/disable UI that
> cannot be persisted. For current runtime boundaries and the module map, defer to
> [architecture.md](architecture.md) and the source.
>
> Related: [project-overview.md](project-overview.md) (product positioning) ·
> [architecture.md](architecture.md) (processes and Agent) · [conventions.md](conventions.md)
> (conventions)

## 1. Background and goals

Once a team has connected many SaaS services, an Agent that relies only on action search and
schema inspect tends to pick services inconsistently, misread parameters, and drift across task
flows. The goal of team-level Skills is to let a team admin configure the Skills most relevant to
the team's workflows into the team workspace, so that when a member switches to that team, the
Agent automatically receives this set of Skills as guidance and calls team connectors and local
tools more accurately.

The feature must satisfy:

- A team owns its own Skill configuration, effective together with the current team's runtime
  Skills.
- When the user switches teams, the connector scope and the team Skill scope change in sync.
- Members can view team Skills; team creators and admins can manage them.
- The configuration must enter the Agent's effective path — not merely show up in the UI.
- The backend API takes Console's existing Skill / team / connection design as reference, but the
  Wanta frontend integrates it into the current three-pane layout and Skills Route structure.

## 2. Conclusions from the Console reference

Console's Skill menu is mainly "my published Skills" management and sharing — not a full
team-level Skill configuration.

Directly reusable parts:

| Scope                      | Console location           | Reusable point                                                                                           |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| My published Skills list   | `src/api/skills.ts`        | `GET search.<endpoint>/v1/packages/-/my-skills?size=100&lang=...`                                        |
| Skill Markdown preview     | `src/api/skills.ts`        | `GET package-assets.../packages/{packageName}/{version}/files/package/skills/{skill}/SKILL.md`           |
| Private Skill temp sharing | `src/api/skills.ts`        | `POST registry.<endpoint>/-/oomol/package-shares/share/{packageName}`, temp sharing only                 |
| Team workspace selection   | `src/stores/team-scope/`   | UI restores a valid stored team and otherwise prefers the `system_created` team                          |
| Team permission schema     | `electron/teams/common.ts` | `Team` returns `role?: "creator" \| "admin" \| "member"` and `writable?: boolean`; prefer backend fields |
| Connector team scope       | `src/api/connections.ts`   | Connector requests switch teams via the `x-oo-organization-name` header                                  |

Parts that must not be copied wholesale:

- Console's Skill page has no "team configuration" concept and never makes the Agent runtime take
  effect.
- Console's temporary share id is unsuitable as long-term team configuration. Configuring a
  private Skill for a team must be validated by the backend against team permissions.
- Wanta already has a more complete Skill page and local runtime management; the team layer should
  be added incrementally, not replaced by Console's single-list page.

## 3. Current Wanta foundation

Wanta already has these building blocks:

- Team list, members, permissions, and app access requests are called directly from the renderer;
  see `src/lib/teams-client.ts`.
- Connector requests already carry `x-oo-organization-name` per workspace; see
  `src/lib/connections-client.ts`.
- The Agent team scope is synced to the main process via `chatService.setAgentTeam`;
  `AgentManager` writes `team-scope.json`, and the custom connector tools read the team name at
  runtime.
- Skills Route has Discover / Installed / install / update / publish / preview; see
  `src/routes/Skills/index.tsx`.
- Runtime Skills are installed to the Wanta runtime skill root via `SkillServiceImpl`, and an
  agent refresh makes OpenCode rescan.
- The team-Skill client, `useTeamSkills` hook, SkillsRoute team tab, composer palette merge, and
  per-turn system prompt (phases 1–3 in §10) are implemented; see §5–§6.

The remaining new work is therefore the per-Skill remote configuration API (§4) and the runtime
file-sync path from team configuration to the Agent (§6.2).

## 4. Backend API design (future work)

Team-level Skills are team policy, so the API belongs on `org-control.<endpoint>`. Skill package
browsing, Markdown preview, and registry info continue to reuse search / registry /
package-assets.

None of the endpoints in this section are live. Until they exist, the client uses the interim
registry association endpoints described in §5.1 and must not call the PATCH, per-Skill DELETE, or
reorder endpoints below.

### 4.1 Team Skill configuration model

```ts
interface TeamSkillConfigItem {
  id: string
  packageName: string
  skillName: string
  version: string
  versionPolicy: "pinned" | "latest"
  displayName: string
  description?: string
  icon?: string
  visibility: "public" | "private" | "unknown"
  enabled: boolean
  order: number
  createdBy: string
  createdAt: string
  updatedAt: string
}
```

Constraints:

- `packageName + skillName` is unique within a team.
- Default `versionPolicy = "pinned"`, storing a concrete version so team configuration stays
  reproducible.
- `latest` is an explicit opt-in only; the backend resolves it to the current latest version in
  the resolved API.
- `enabled=false` keeps the configuration but excludes it from the Agent's effective set.

### 4.2 Read team configuration

```http
GET /v1/organizations/{teamId}/skills
Host: org-control.<endpoint>
```

Response:

```json
{
  "skills": [
    {
      "id": "team-skill-1",
      "packageName": "@oomol/gmail-skills",
      "skillName": "gmail-report",
      "version": "1.2.3",
      "versionPolicy": "pinned",
      "displayName": "Gmail Report",
      "description": "Generate repeatable Gmail summaries and reports.",
      "icon": ":mail:",
      "visibility": "private",
      "enabled": true,
      "order": 100,
      "createdBy": "user_id",
      "createdAt": "2026-06-25T00:00:00.000Z",
      "updatedAt": "2026-06-25T00:00:00.000Z"
    }
  ],
  "updatedAt": "2026-06-25T00:00:00.000Z"
}
```

Permissions:

- Team creators, admins, and members can read.
- A user outside the team gets 403.

### 4.3 Add configuration

```http
POST /v1/organizations/{teamId}/skills
Host: org-control.<endpoint>
Content-Type: application/json
```

Request:

```json
{
  "packageName": "@oomol/gmail-skills",
  "skillName": "gmail-report",
  "version": "1.2.3",
  "versionPolicy": "pinned",
  "enabled": true
}
```

Permissions:

- Team creators and admins can write.
- The backend validates that the package exists, the skill belongs to that package, and a private
  package is visible to the team or the operator.

### 4.4 Update configuration

```http
PATCH /v1/organizations/{teamId}/skills/{configId}
Host: org-control.<endpoint>
Content-Type: application/json
```

Request:

```json
{
  "enabled": false,
  "order": 200,
  "version": "1.2.4",
  "versionPolicy": "pinned"
}
```

### 4.5 Delete configuration

```http
DELETE /v1/organizations/{teamId}/skills/{configId}
Host: org-control.<endpoint>
```

### 4.6 Bulk reorder

```http
PUT /v1/organizations/{teamId}/skills/order
Host: org-control.<endpoint>
Content-Type: application/json
```

Request:

```json
{
  "items": [
    { "id": "team-skill-1", "order": 100 },
    { "id": "team-skill-2", "order": 200 }
  ]
}
```

### 4.7 Resolved API

For Skills to truly enter the Agent runtime, Wanta ultimately needs a downloadable, verifiable
Skill artifact. Proposed addition:

```http
GET /v1/organizations/{teamId}/skills/resolved
Host: org-control.<endpoint>
```

Response:

```json
{
  "skills": [
    {
      "configId": "team-skill-1",
      "packageName": "@oomol/gmail-skills",
      "skillName": "gmail-report",
      "version": "1.2.3",
      "archiveUrl": "https://package-assets.oomol.com/packages/@oomol/gmail-skills/1.2.3/files/package/skills/gmail-report.tgz",
      "checksum": "sha256:...",
      "manifest": {
        "format": "oomol-skill-archive",
        "entry": "SKILL.md",
        "files": [
          { "path": "SKILL.md", "checksum": "sha256:..." },
          { "path": "assets/logo.png", "checksum": "sha256:..." }
        ]
      }
    }
  ],
  "updatedAt": "2026-06-25T00:00:00.000Z"
}
```

The `resolved` endpoint must be the authoritative entry point for runtime resolution: the backend
performs package permission checks, version resolution, artifact URL generation, and
checksum/manifest generation there. Wanta only downloads the single Skill artifact per the
response, verifies integrity against `checksum` and `manifest.files`, and only then releases it
into the runtime.

If the registry has no single-Skill archive in the short term, it may temporarily return
`assetBaseUrl` + `skillPath` as a directory fallback — but it must still return the manifest and a
checksum per file. The client must never infer structure from directory paths alone, or it will
miss `references/`, `assets/`, scripts, or assets added later.

## 5. Wanta frontend integration

### 5.1 Request client

`src/lib/team-skills-client.ts` exists and, until the §4 API ships, targets the registry's
package ↔ team association endpoints:

- `listTeamSkills(teamId)` — `GET /-/oomol/orgs/{teamId}/package-infos` on the registry base URL;
  the response is normalized (`normalizeTeamSkillPackages`) into `TeamSkillConfigItem`s, one per
  skill in each associated package.
- `addTeamSkill(teamId, input)` — `PUT /-/oomol/packages/{packageName}/orgs/{teamId}`; this
  associates the whole package. `skillName` only feeds the local optimistic item; after refresh
  the backend `package-infos` is the source of truth.
- `removeTeamSkill(teamId, packageName)` — `DELETE` on the same URL; note it takes a
  `packageName`, not a per-Skill `configId`, because the association is package-level.
- `teamSkillsApiEnabled()` — feature switch read from `VITE_WANTA_TEAM_SKILLS_API` (legacy alias
  `VITE_WANTA_ORGANIZATION_SKILLS_API`); `0` / `false` / `off` disable it.
- `teamSkillMentionId(skill)` — stable `team:`-prefixed id used for composer mentions.

Still proposals, blocked on the §4 model: `updateTeamSkill(teamId, configId, patch)`,
`reorderTeamSkills(teamId, items)`, `listResolvedTeamSkills(teamId)` (used in the runtime sync
phase), `listMyPublishedSkills(locale)` (per Console `my-skills`), and
`readSkillMarkdown(packageName, version, skillName)`.

Binding implementation requirements (the current client satisfies them; keep them true):

- Use `oomolFetchJson` / `oomolFetch` uniformly.
- Base URLs derive from `@/lib/domain`; if a `packageAssetsBaseUrl` constant is added, it must
  also come from `electron/domain.ts`.
- Never set `Authorization` / `Cookie` in the renderer; keep relying on the httpOnly `oomol-token`
  cookie.
- Normalize 401 into the existing auth_required flow.

### 5.2 SkillsRoute receives the workspace

Implemented. `AppShell` holds `teamWorkspace` and renders:

```tsx
<SkillsRoute workspace={teamWorkspace} />
```

In practice the wiring went further than this plan: `SkillsRoute` also receives `teamSkills` (from
`useTeamSkills`) plus connected-provider props (see `src/components/app-shell/AppShell.tsx` and
the props in `src/routes/Skills/index.tsx`). Inside `SkillsRoute`, the team configuration area is
gated on `workspace.activeWorkspace` (team tab shown when `activeWorkspace.teamId` is set):

- Team object not yet resolved: show loading.
- Team resolved: show the team configuration tab / section.

### 5.3 Hook

Implemented as `src/hooks/useTeamSkills.ts` (not the originally proposed `useTeamSkillConfig`):

```ts
interface UseTeamSkills {
  addSkill(input: AddTeamSkillInput, options?: { refresh?: boolean }): Promise<void>
  apiEnabled: boolean
  canManage: boolean
  chatContextSkills: TeamSkillChatContext[]
  error: UserFacingError | null
  hasLoaded: boolean
  loading: boolean
  teamId: string | null
  teamName: string | null
  refresh(options?: { forceRefresh?: boolean }): Promise<void>
  removePackage(packageName: string): Promise<void>
  skills: TeamSkillConfigItem[]
}
```

`updateSkill` / `reorder` are deliberately absent: they cannot be persisted under the current
package-level association and arrive with the §4 model. Caching is keyed per team (30 s in-memory
cache plus a persisted cache under `wanta.team-skill-cache.v3`, 24 h max age, capped entries;
the legacy `wanta.organization-skill-cache.v2` key is migrated). Switching teams must clear the
previous team's configuration state so the wrong team's Skills are never shown, even briefly.

### 5.4 UI structure

The team area lives inside the existing Skills page — no new top-level route. The team tab and the
team management flow are implemented (see `src/routes/Skills/index.tsx` and
`src/routes/Skills/team-skill-manage-helpers.ts`):

- The current team name shows at the top.
- In team state, a `Team Skills` section is shown.
- Configured Skills list: icon, displayName, packageName@version, enabled state, update time.
- Team-manager-visible operations: Add and Remove today; Enable/Disable, Update version, and Reorder
  are blocked on the §4 per-Skill model and must not be offered until it ships.
- Members are read-only; the action area explains that a team manager controls the configuration.

Add Skill panel (design intent; verify against the source for current coverage):

- Data source tabs:
  - My published: uses Console's `my-skills` API.
  - Public: reuses Wanta's existing public catalog.
- Search matches displayName / skillName / packageName / description.
- Select a concrete skill, not just a package (note: persistence is package-level until §4).
- `SKILL.md` preview on the right.
- Confirmation calls the team configuration add API.

### 5.5 Composer palette

Implemented. `buildSkillPaletteItems` (`src/routes/Chat/composer-palette-items.ts`) takes a
`teamSkills` parameter, and `AppShell` injects the team Skills from `useTeamSkills`. The merged
palette is: creator skill, then team Skills, then runtime inventory, with these rules:

- Team Skills sort before local runtime Skills.
- On a name/identity collision, the team configuration wins — matching inventory items are
  deduplicated out.
- Disabled team Skills do not enter the palette.
- Team Skill items show `team` as their meta.
- Selecting one still produces a `ChatContextMention { kind: "skill" }` that enters the current
  turn's system prompt.

Merge and dedup behavior is covered by `src/routes/Chat/composer-palette-items.test.ts`.

## 6. Agent effective path

Team-level Skills take effect in two stages.

### 6.1 Stage one: system prompt (implemented)

This was the minimum deliverable; it does not require syncing Skill files. It is live end to end:

1. The renderer loads the team Skill configuration after a team switch, and passes the enabled
   team Skills through `ChatRoute` → `useChat` (`src/hooks/useChat.ts`).
2. `SendMessageRequest` carries a `teamSkills` field (`electron/chat/common.ts`).
3. `buildTeamSkillsSystem` (`electron/chat/context-system.ts`) builds the per-turn team Skills
   system prompt.
4. `sendMessage` in `electron/chat/node.ts` merges it (`mergeSystemPrompts`) with the existing
   context / project / permission / bug-report systems before `AgentManager.promptStreaming`.

Prompt principles (encoded in `buildTeamSkillsSystem`):

- It only states "the team configured these Skills for the current workspace" — never forces use.
- It says explicitly to use them only when relevant to the user's actual task.
- An explicit `@skill` selection outweighs the team default configuration.
- It never inlines full `SKILL.md` bodies into every turn's system prompt (prompt bloat); only
  name, id, package, version, description.

Actual output shape:

```text
Team-configured skills for the active workspace:
- Treat these skills as workspace guidance, not mandatory tool calls.
- Use them only when they are relevant to the user's actual task.
- If the user selected a different explicit context for this turn, prefer the explicit user selection.
- "Gmail Report"; id: "gmail-report"; package: "@oomol/gmail-skills"; description: "Generate repeatable Gmail summaries and reports."
```

Strength: team switches take effect immediately; low implementation risk. Limitation: it is not
equivalent to OpenCode-native Skill loading — a complex Skill's `references/` and scripts cannot
be read automatically.

### 6.2 Stage two: runtime Skill file sync (future work)

The complete solution syncs team Skills into Wanta's app-private runtime skill root so OpenCode
scans real `SKILL.md` files and their companion assets.

Proposed directories:

```text
userData/agent/team-skills/{teamId}/{skillName}/
userData/agent/workspace/.opencode/skill/{skillName}/
```

Cautions:

- Never write `~/.agents/skills` — do not pollute the user's home directory or other agents.
- Never delete bundled skills.
- Never delete the user's local runtime skills, unless a "team overrides same-name skill" policy
  is explicitly adopted.
- Duplicate `skillName` within a team is forbidden.
- Trigger the agent refresh only after the sync completes on a team switch.

Sync flow:

1. Renderer or main process learns the active team changed.
2. Main process fetches the `resolved` API.
3. Download each enabled Skill artifact.
4. Verify checksums.
5. Write into `userData/agent/team-skills/{teamId}/`.
6. Rebuild the team Skill mapping inside `.opencode/skill/`.
7. Reuse the `AgentRefreshScheduler` (`electron/agent-refresh-scheduler.ts`, triggered via the
   `onRuntimeSkillsChanged` callback in `electron/main.ts` → `agentRefreshScheduler.schedule()`)
   to refresh the sidecar.
8. If a generation is active, keep the existing busy-retry behavior — refresh after the reply
   completes.

Put the remote sync logic in a new module, e.g. `electron/team-skills/`; do not keep growing
`SkillServiceImpl` into a giant class.

## 7. Team switch flow

Wanta restores a valid team id stored for the account. If that selection is missing or no longer
available, it selects the `system_created` team, falling back to the first team only for legacy
responses that do not expose that field. Duplicate entries from the created and joined team lists
are merged so role, writability, and system-team metadata all survive.

After a team switch the following happens (step 7 is stage two, future work):

1. `useTeamWorkspace` updates the active workspace.
2. `useConnections` refreshes the connector summary with the team name.
3. `chatService.setAgentTeam` updates the main-process agent team name (existing behavior).
4. `useTeamSkills` loads the team Skill configuration.
5. The composer palette refreshes team Skills.
6. Stage one: the next turn's system prompt carries the team Skill summary.
7. Stage two: the main process syncs Skill files and refreshes the agent runtime.

If a team id is selected but the team name is not yet resolved:

- Connector requests must stay pending and the current connector summary must be cleared; never
  reuse the previous team workspace's `x-oo-organization-name`.
- Team Skill configuration may be read by team id.
- `chatService.setAgentTeam` must first clear the main-process agent team name; the Agent
  connector tool pauses team connector calls until the new team name is available and the
  connector scope refresh has completed.
- Once the team name is available, refresh the connector summary with the new team name first,
  then restore the Agent connector tool and UI operations, so every connector/tool request uses
  the new team context.

## 8. Permissions and security

- Team Skills are manageable only by users who can manage the team; prefer the team schema's
  `writable` field, and fall back to creator/admin role inference only when the field is absent.
- The team role is for displaying creator/admin/member; prefer the backend `role` when returned, and
  only fall back to `creator_user_id` plus the created list for older responses.
- Team creators and admins may change any non-creator member between member and admin through the
  team member role endpoint. An admin cannot change their own role, and the creator role is not
  editable.
- Private package permissions must be validated by the backend; never accept a client-supplied
  share id as a bypass.
- The renderer never touches the session token.
- When the main process syncs Skill files, it must validate paths — artifact extraction must never
  write outside the target directory.
- `skillName` must pass safety validation before use as a directory name: reject `/`, `\`, `.`,
  `..`.
- Artifact downloads need a size limit and a timeout.
- Team Skills must never enter an external agent skill root.

## 9. Version and update strategy

Default policy:

- Adding a team Skill stores a concrete `version` with `versionPolicy = "pinned"`.
- After the §4 per-Skill model ships, the UI offers "Update to latest".
- The backend or Wanta can check whether a team Skill has a newer version.
- The `latest` policy is for advanced scenarios only; the UI must state clearly that it changes
  automatically.

Update checks can reuse the existing registry version-check approach, but team Skill check results
must be displayed separately from local Installed Skills, so users do not mistake locally
installed Skills as needing updates.

## 10. Implementation phases

### Phase 1: backend API and read-only frontend — done

- Reads go through the team `package-infos` endpoint (interim; the §4 `GET /skills` replaces it).
- `team-skills-client.ts` exists in Wanta.
- SkillsRoute shows the team Skill list in team state.
- State is correctly isolated across team switches.

### Phase 2: team Skill management UI — done (within current backend limits)

- Creator can add / remove (package-level); enable/disable and reorder await the §4 model.
- Add Skill reuses the public catalog and Console `my-skills`.
- `SKILL.md` preview supported.
- Members read-only.

### Phase 3: system prompt MVP — done

- The team Skill summary enters each turn's system prompt (`buildTeamSkillsSystem`).
- The composer palette merges team Skills.
- Tests cover prompt construction and palette merging.

### Phase 4: full runtime sync — future

- Backend provides the resolved artifact API.
- Main process syncs team Skills into the app-private runtime root.
- Agent refresh after team switches.
- Handle active-generation busy retry.

### Phase 5: version management and governance — future

- Team Skill update checks.
- Update to latest.
- Operation audit / updatedBy.
- Same-name conflict policy made explicit in the UI.

## 11. Testing recommendations

Pure functions / unit tests:

- Team skill API normalization.
- Cache key isolation after a team switch.
- Team manager / member permission UI model.
- Team skill + installed skill palette merge and dedup (covered by
  `src/routes/Chat/composer-palette-items.test.ts`).
- System prompt construction: no forced use, no leakage of unrelated data, explicit mentions win.
- Artifact path validation and extraction directory-escape protection.

Integration / manual verification:

- No team Skill configuration shown while the team identity is unresolved.
- After switching team A → B, the list, composer, and agent scope all change in sync.
- Team members are read-only.
- After a team manager adds a private Skill, members can see it and use it in the team workspace.
- Modifying team Skills during an active generation does not interrupt the current reply.
- After logout, the team Skill cache does not leak into the next account.

## 12. Key risks

- UI-only configuration that never enters the Agent's effective path misses the product goal.
- Using a temporary share id for long-term team configuration breaks when it expires.
- Automatic `latest` drift makes team task results non-reproducible within a team.
- Mixing team id and team name scrambles the org-control and connector scopes.
- A runtime sync that crudely rebuilds `.opencode/skill/` can delete bundled skills or local
  runtime skills.
- Restarting the sidecar mid-generation hurts the user experience; the existing deferred-refresh
  strategy must be kept.
