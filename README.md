# ADO Board

A fast, focused desktop client for an Azure DevOps team: the backlog and the sprint taskboard, with
editing and creating work items, without the rest of the ADO chrome. Electron + React 19 + Tailwind v4 + TanStack Query.

## Run

```bash
npm install        # plain npmjs.org (pinned in .npmrc), no private feeds
npm run dev        # Electron with hot reload
npm run build && npm start   # production build preview
npm run typecheck
npm run dist       # macOS app: release/ADO Board-<version>-arm64.dmg (+ .zip); `npm run pack` = .app only
```

## Install

Download the `.dmg` from [Releases](https://github.com/juwel-development/P-ADO-Board/releases) (Apple Silicon
only). The app is signed with a Developer ID and notarized, and updates itself from GitHub Releases.

## Release

Releases are automatic: [semantic-release](https://semantic-release.gitbook.io) derives the version from
[Conventional Commits](https://www.conventionalcommits.org) (`fix:` → patch, `feat:` → minor, `BREAKING CHANGE`
→ major), which husky + commitlint enforce on every commit. On each push to `main`,
`.github/workflows/release.yml` previews the next version; once the `release` environment is approved it
bumps `package.json`, builds, signs and notarizes the app, tags, publishes the GitHub release with the
notes, and commits `CHANGELOG.md`. Installed apps pick the release up on their next update check.

## Building it yourself

`npm run dist` needs no certificate: without a *Developer ID Application* identity in the keychain the app
is signed ad-hoc (`scripts/sign-mac.cjs`) and not notarized. It runs on the Mac that built it; on another
Mac, Gatekeeper blocks the first start (right-click → *Open*, or
`xattr -dr com.apple.quarantine "/Applications/ADO Board.app"`). Such a build can't update itself.

The packaged app shares settings, subscriptions and
templates with the dev build (same data folder), but ignores `.env`: enter the PAT in the app, and set
`ADO_BOARD_WRITES` only via the environment (unset = `live`). On first start macOS may ask once to
allow access to the *ADO Board Safe Storage* Keychain item.

On first start, enter the organization URL (e.g. `https://dev.azure.com/your-org`) and a
PAT with **Work Items (Read)** and **Project and Team (Read)** scopes, then pick project and team.
Optionally add **Identity (Read)** so `@mentions` of people outside the team resolve to names and can be
found when mentioning someone.
In dev (`npm run dev`), a `PAT=` line in the gitignored `.env` is used when no PAT is stored.

## Features

- **Sprint board** — swimlanes per backlog item (or per person / flat), taskboard columns read from
  the team's taskboard config (falls back to the task type's states), remaining hours per column/lane,
  sprint progress and working days left.
- **Backlog** — every backlog level of the process (Epics / Features / requirement level) in backlog
  order, optional parent tree, lazy-loaded children, completed toggle.
- **Work item drawer** — fields, description / acceptance criteria / repro steps (sanitized, inline
  images authenticated), parent/child/related links you can navigate, discussion.
- **Subscriptions & inbox** — get notified when someone else changes an item you follow (see below).
- **Filters** — keyword or `#id`, Mine, people, type, tags; shared by board and backlog.
- **Command palette** (`⌘K`) — jump to any loaded item or an ID, sprints, backlogs, actions.
- Light / dark / system theme. Process-agnostic: work item types, colors, icons, states and state
  categories all come from the project (custom/inherited processes work).

| Shortcut | Action |
|---|---|
| `⌘K` | Command palette |
| `/` | Focus filter |
| `1` / `2` / `3` | Sprint board / Backlog / Inbox |
| `R` | Refresh |
| `⌘\` | Toggle sidebar |
| `C` | New work item |
| `⌥↑` / `⌥↓` | Move focused backlog row (with `⇧`: to top / bottom) |
| `⌘↵` | Save editor / create |
| `Esc` | Close drawer / palette / editor |

## Editing & creating

| Where | What |
|---|---|
| Drawer | Click to edit title, state, assignee, iteration, priority, effort / remaining / completed, activity, tags. Description, acceptance criteria and repro steps: Markdown editor (Write/Preview) for markdown fields, rich-text editor for HTML fields. Add comments. "Add child". |
| Sprint board | Drag a card to another column → state change (uses the column's state mapping). In *Group by person*, drag to another person → reassign. "+ Task" on a lane header → type tasks in quick succession under that item. |
| Backlog | Quick-add row at the top (pick type, type title, Enter). |
| Anywhere | `C` or "New work item" → create dialog with type, parent, iteration, area, estimates, tags, description and any custom always-required fields. `⌘↵` creates; "Create more" keeps it open. |

Every change is applied optimistically, rolled back with an error toast if Azure DevOps rejects it,
and offers **Undo**. Updates carry a `test /rev` operation, so a change made by someone else in the
meantime is never overwritten — you get a "changed meanwhile" message and fresh data instead.

### Backlog order

Prioritise any backlog level (Epics, Features, Stories…):

- **Drag** a row (grip appears on hover); a blue line shows where it lands.
- **Keyboard:** focus a row (click its empty space or Tab) and press `⌥↑` / `⌥↓` to move one step,
  `⌥⇧↑` / `⌥⇧↓` to move to top / bottom.
- **Row menu** (`⋯` on hover): Move to top / up / down / to bottom.

Moves use Azure DevOps' backlog reorder API (`PATCH {project}/{team}/_apis/work/workitemsorder`), which
places the item between two neighbours and lets ADO compute the order value (Stack Rank / Backlog
Priority). Things to know:

- The order is a field on the work item, so a move is visible to **every team** whose backlog shows it.
- With filters active, "move up" means "directly before the previous *visible* item"; hidden items keep
  their relative order.
- In the **Parents** view items move among siblings of the same parent only (`parentId` is sent);
  dragging onto a row under a different parent is not possible.
- **Expanded children** (e.g. the stories/buffers under a Feature on the Features backlog, or the
  tasks under a story) are shown in backlog order and can be reordered among their siblings the same
  way (`parentId` = the expanded row). A child that isn't on your team's backlog (other area path)
  can't be ordered by your team — Azure DevOps rejects it and the move is rolled back.
- Every move can be undone from its toast. In `validate` mode moves are **not sent** at all (the API
  has no validate-only option) — you'll see a notice instead.

### Markdown descriptions

Description, acceptance criteria and repro steps are always edited in **Markdown** (Write/Preview,
`⌘B`/`⌘I`, `#123` links work items). Fields that are still HTML in Azure DevOps are converted when
the editor opens — tables, task lists, images, work item and person mentions are kept — and saved as
Markdown. Azure DevOps can't convert a field back to HTML; the editor says so and offers
*Edit as rich text instead* for that item.

### @mentions

Type `@` in a comment or in description / acceptance criteria / repro steps (Markdown editor) to
mention someone: the list offers team members and people seen on loaded items and in the discussion
(`↑`/`↓`, `Enter`/`Tab` to pick, `Esc` to close). The text shows `@Display Name`; on save it becomes
Azure DevOps' own markdown mention `@<identity id>`, the same form the web UI writes, so ADO notifies the
person. A full display name typed by hand is converted too (unless two people share it); mentions
already in a field show as names while editing and are saved back unchanged.
People outside the team are searched in the organization when the PAT has **Identity (Read)**;
without it, the list stays limited to the people the app already knows.

### Description templates

Local templates fill the description: **Template** in the description editor (drawer and create
dialog), or the button next to an empty description. Templates matching the item's type are listed
first; **Undo template** restores what you had. Placeholders: `{{title}}`, `{{date}}`, `{{me}}`.

Templates are plain markdown files in the `templates` folder of the app's data directory (the
manager's *Open templates folder* reveals it). Manage them in the app (sidebar → templates icon, or
`⌘K` → *Description templates*) or in any editor:

```markdown
---
name: User story
types: User Story, Product Backlog Item
---
## Objective
…
```

Leave `types` empty for "any type". Three starters (User story, Bug report, Spike) are created on
first launch; deleting them is permanent.

### Subscriptions & inbox

- You automatically follow every **open item you created** in the project (anything not in a
  Completed/Removed state). Follow any other item with **Subscribe** (bell) in the item panel;
  unsubscribing from one of your own items mutes it until you choose *Follow them again*.
- While the app runs it checks every **5 minutes** (and shortly after start, so it catches up on what
  happened while it was closed). *Check now* in the Inbox or the command palette forces a check.
- Reported: description / repro steps / acceptance criteria (with the changed lines), tags, state,
  assignment, comments (with a preview), links, and any other field. Your own changes and bookkeeping
  fields (backlog order, board column moves that follow a state change, dates…) are ignored.
- **@mentions** anywhere in the project (comments and description edits, also on items you don't
  follow) are found via the `@RecentMentions` query and always get their own notification; the Inbox
  has a *Mentions* filter. Mentions that already existed on the first check are only recorded.
- **Repositories:** *Inbox → Subscribed → Follow repository* lists every repository of the organization.
  New pull requests in followed repositories are reported (not your own; optionally only into given
  target branches, e.g. `develop`); drafts are marked. Being **added as a reviewer** is reported for any
  repository in the board's project and the projects of followed repositories, and always gets its own
  notification. PRs open in the browser. Needs the PAT scope **Code (Read)**; without it the Inbox says
  so and work item notifications keep working.
- **Sidebar → Repositories** lists followed repositories, most open pull requests first, with the count (a dot
  when one waits for your review). Clicking one shows its open PRs: author, branches, age, reviewers with
  their votes, Draft / Conflicts / *Your review* badges, filters *All / Needs my review / Mine* and a
  search. Clicking a PR opens it in Azure DevOps.
- **Desktop notifications are opt-in.** After connecting, a card asks to turn them on; doing so posts a
  test notification, which is when macOS shows its permission dialog (the dev build is listed as
  *Electron*). If macOS refuses, the card links to System Settings → Notifications. Toggle later via
  *Notifications on/off* in the Inbox. Electron can't query the permission state, so a test
  notification is the only reliable check.
  If it fails with `UNErrorDomain error 1` without a dialog, the dev Electron.app's signature is broken
  (happens with the npm download); `npm install` runs `scripts/fix-electron-signature.mjs`, which
  re-signs it ad-hoc.
- A macOS notification per item (or one summary when more than three changed) when the window is in
  the background, a toast when it's in front (toasts don't need the permission). The **Inbox** (`3`) keeps the history; the dock badge
  shows the unread count. Opening an item marks its updates read.
- Subscriptions and the inbox live locally in `subscriptions.json` in the app's data folder (one
  section per org + project). Nothing is written to Azure DevOps; checking costs one WIQL query and one
  batch request, plus one revisions request per changed item (and one more query for mentions; per followed repository one pull request request, plus one review
  query per project).

### Write modes (safety)

`ADO_BOARD_WRITES` (environment variable, or a line in the dev `.env`):

| Value | Behaviour |
|---|---|
| `validate` | Changes are sent with `validateOnly=true`: Azure DevOps checks them (rules, transitions, required fields) but **saves nothing**. Comments are never sent. Sidebar shows *Validate mode*. **Recommended for a first try.** |
| `off` | Read-only, as before; no edit UI at all. |
| `live` / unset | Changes are saved. |
| anything else | Treated as `off` (a typo never enables writes). |

Independently of the mode, the main process (`src/main/guard.ts`) only lets four kinds of writes
through: update a work item (`PATCH …/workitems/{id}`), create one (`POST …/workitems/$Type`), add a
comment, and reorder the team backlog (`PATCH {project}/{team}/_apis/work/workitemsorder`). Deleting,
bulk updates, `bypassRules`, sprint ordering, settings etc. are always blocked.

## Architecture

```
src/main/        Electron main — owns the PAT and all HTTP to ADO
  settings.ts    connection in userData/settings.json, PAT encrypted via safeStorage (Keychain)
  guard.ts       allowlist: reads + work item update/create + add comment; write modes
  templates.ts   local description templates (markdown files with a small front matter)
  watch.ts       local subscription/inbox store (userData/subscriptions.json); notifications in index.ts
  ado.ts         REST client (validateOnly in validate mode); ado-asset:// proxy for
                 avatars/attachments with auth (org host only)
src/preload/     contextBridge → window.ado (BridgeApi in src/shared/ipc.ts)
src/renderer/src
  lib/api.ts     typed ADO endpoints (api-version 7.1)
  lib/queries.ts TanStack Query hooks (meta, iterations, sprint, backlog, item, comments, templates…)
  lib/model.ts   process metadata + pure board logic (lanes, column placement, filters)
  lib/mutations.ts  update/create/comment/reorder with optimistic cache updates, rollback, undo
  lib/reorder.ts    backlog moves as (previousId, nextId) — pure, unit-tested
  lib/mentions.ts   `@Name` ⇄ `@<GUID>` while editing, mention detection and people matching — pure
  lib/richtext.ts   ADO markdown/HTML → safe HTML, mentions, HTML → markdown for editing
  lib/watch.ts      subscriptions, 5-minute check, inbox, notifications
  lib/changes.ts    revisions → readable changes (pure, unit-tested)
  lib/pulls.ts      which pull request events to report (pure, unit-tested)
  lib/store.ts   UI state (zustand; view prefs persisted to localStorage)
  views/         SprintBoard, Backlog, Inbox, PullRequests
  components/    Sidebar, FilterBar, WorkItemCard, WorkItemDrawer, CommandPalette, ConnectForm,
                 CreateDialog, editors (Select, PersonSelect, TagEditor, MarkdownEditor…), Templates, RichText, Toaster
```

The renderer never sees the token; the main process enforces the write allowlist.

## App icon

The original taskboard icon uses indigo, ivory and amber, without Microsoft or Azure logos or lettering.
The editable source is `build/icon.svg`; `build/icon.png` (1024 px) and `build/icon.icns` are the
generated app assets. The macOS package uses the ICNS file, and development uses the PNG in the Dock.
After editing the SVG, run `npm run icons`
on macOS to regenerate both assets locally using AppKit and `iconutil`; no network or extra dependencies
are required.

## Next steps (ideas)

- Re-parenting via drag (board lanes, backlog Parents view) and ordering within a sprint.
- Customized taskboard columns that share a state (needs the taskboardworkitems API, not yet allowed).
- Kanban board view (`/_apis/work/boards`), burndown chart, saved filters.