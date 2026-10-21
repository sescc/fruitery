# 2026-10-20 — deploy, desktop shell, phone editor, polish

## 0. Continuation brief
**Current state.** All three components are built. Two web changes and two desktop changes are archived.
- **Web:** the Cloudflare Worker + D1 + PWA is deployed and verified on the owner's real account.
  - Access logins (Google identity provider, email PIN, Cloudflare account), phone install, two-way phone↔PC ticks,
    offline cold start and phone editing were all verified.
- **Desktop:** the portable Electron app (`desktop-shell` + `desktop-polish`) is built, packaged and installed by the owner.
  It still runs on its **local cache only**: `desktop-sync` is proposed and approved, but only task 1.1 (the Worker side,
  service tokens) is built.
- **Not yet deployed:** the `desktop-polish` PWA icons/CSP/SW icon cache and the 1.1 service-token auth need
  `npm run deploy:web`.
- **Repo:** public-ready (D53/D107, re-audited by an independent agent). Nothing is committed; the owner commits at the MVP.

**Next step.** Apply `desktop-sync` tasks 2.1 → 5.3 (desktop key storage, sync engine, UI, D89 confirmation, smoke
harness, setup guide), with fresh Sonnet agents. Then walk the owner through creating a service token per PC.

**Resume command/check.** `openspec status --change desktop-sync`, then read `openspec/changes/desktop-sync/tasks.md`
and `design.md`, then `docs/desktop/STATUS.md` (deferred manual checks, D131).

## 1. Work completed
- **First deploy (spike c), owner-run with walkthroughs:**
  - wrangler login and D1 create (the id stays local, D67);
  - migrations 0001–0003, seed and deploy;
  - Worker-level Access via the Worker's **Access** tab (D74), plus a policy Emails rule, the Google identity provider
    (in testing mode, owner as test user) with passkeys (D75), and 1-month sessions;
  - secrets `OWNER_EMAIL` (comma list, D77), `TEAM_DOMAIN`, `POLICY_AUD`;
  - debugged via reason codes: `jwt-config-missing` → set `POLICY_AUD`/`TEAM_DOMAIN`; the policy at first allowed only account members.
- **web-checklist follow-ups:**
  - `ctx.access` support (D73);
  - diagnosable 403 reasons (D76);
  - first-deploy tooling: a generated local wrangler config (D67/D68);
  - offline cold-start snapshot (D78/D81);
  - `Item.userAgent` + migration 0002 (D70/D82).
  - Archived 2026-10-15.
- **desktop-shell:**
  - rail, list and splits; sleep/wake; partitions and cookie persistence; UA presets incl. popups (D83);
  - Edge/app open; tray/autostart; editors; packaging and install script;
  - feedback fixes:
    - no "null" header; resizable list (D90/D91);
    - popup routing (D96), then same-pane sign-in (D98);
    - bottom add-bar; 5-pane toast; "Extend short logins" (D102); ungrouped label;
    - F3 edit (D113); dialog overlay races (D108).
  - Archived 2026-10-16.
- **phone-editor:**
  - shared `removalPlan` (D92); desktop-only fields preserved (D93); edit needs a connection (D94); SW precache guard (D95);
  - follow-ups: `Workspace.ungroupedLabel` + migration 0003 (D99), Links section (D100), drag reorder (D101), smaller arrows.
  - Archived 2026-10-20.
- **desktop-polish:**
  - shortcuts F3/F5/F6, Alt+←/→, `app-command` (D118/D129);
  - Done/Next with no prompt, List removed (D119, supersedes D8); always-visible tick + return toast (D117);
  - pane-title copy/edit (D120); page actions + right-click menu (D121);
  - icons: desktop on-load capture + a Refresh button, phone SW cache (D116, D122–D128).
  - Archived 2026-10-20.
- **desktop-sync:** proposed (D111); task 1.1 built. The Worker accepts allow-listed service tokens (D103, D114, D115);
  findings are in `docs/web/general/service-tokens.md`.
- **Privacy:**
  - global rule added: never name third-party services the owner uses (D107);
  - repo-wide scrub: example SEED is fictional (except Google Calendar), groups Study/Perks/Fun;
  - independent re-audit verdict PUBLIC-READY; follow-up nits fixed;
  - naming the AI tooling allowed (D110).

## 2. Decisions
Full table: `CLAUDE.md` D73–D131. Key kept/discarded:

| Decision | Verdict | Why |
|---|---|---|
| Desktop → API auth | per-PC service token (kept); email PIN window / system-browser hand-off (discarded) | Google forbids embedded OAuth; revocable per PC |
| Popup routing | same-pane for new-tab sign-ins (kept); app window for all sign-ins (superseded) | a sign-in finishing in a small window left the pane logged out |
| Icons | desktop on-load + manual refresh, per PC (kept); background fetch / third-party icon service (discarded) | no background traffic; no leaking the site list |
| Icon sync via `Item.icon` | discarded | would overwrite newer phone edits under LWW |
| "Mark done?" prompt (D8) | discarded (D119) | friction |
| Movable "Default" section | KIV (D112) | Links sit on top; model change not worth it yet |
| Keep-logins "off" deleting site cookies | discarded → rename to "Extend short logins" (D102) | the switch never touched site-set long-lived cookies |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
|---|---|---|
| `npm test` (root) | 529 pass, 0 fail (core 146, web 174, desktop 209) | all three components incl. the polish and service tokens |
| desktop smoke / smoke:restart | SMOKE OK 243 / 27 checks; packaged smoke 243 | end-to-end shell behaviour from source and the installed folder |
| `openspec validate --all --strict` | 9/9 valid | specs and the in-flight change are well-formed |
| temp-repo drift check (D64) | 0 dead / 321 refs | docs map to real code |
| independent privacy re-audit | PUBLIC-READY (nits fixed) | D53/D107 hold |
| real deployment (owner) | all three Access logins reach the checklist; phone install, sync both ways, offline cold start, phone editing pass | web works on the real account |

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
|---|---|---|---|---|
| git | `<repo>` | no commits; all files untracked (owner commits at the MVP) | `wsl -e git -C <repo-in-wsl> status --short` | owner |
| deployment | Cloudflare Worker `fruitery` + D1 `fruitery` + Access app | live; running the code from before the `desktop-polish` and 1.1 changes | open the Fruitery address; `npm exec -w apps/web -- wrangler tail` | `npm run deploy:web` to update |
| secrets (names only) | `OWNER_EMAIL`, `TEAM_DOMAIN`, `POLICY_AUD` set; `SERVICE_TOKEN_IDS` not yet | — | Cloudflare dashboard → Worker → Settings | `wrangler secret put …` |
| local files (git-ignored) | `config/seed.local.json`, `config/cloudflare.local.json`, `apps/web/.dev.vars` (`DEV_NO_AUTH=1`), `apps/web/.local/` | present | — | keep |
| desktop install | the owner's own install folder with `data\` (logins, cache, icons) | installed (pre-F3/polish build unless reinstalled) | run `Fruitery.exe` | update: `npm run package:desktop` then `npm run install:desktop -- --to "<folder>"` |
| processes | none (no Fruitery, Electron or workerd running) | — | `Get-Process Fruitery,electron,workerd` | — |
| artifacts | `apps/desktop/release/`, `.cache/electron`, `apps/web/dist/` | built, git-ignored | — | regenerated by the build scripts |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
|---|---|---|---|
| `desktop-sync` | 1/11 | in-progress (planning complete) | apply tasks 2.1 → 5.3 |

Archived this period: `web-checklist` (2026-10-15), `desktop-shell` (2026-10-16), `phone-editor` (2026-10-20),
`desktop-polish` (2026-10-20). Main specs: checklist-schedule 5, desktop-items 7, desktop-sessions 5,
desktop-workspaces 5, item-model 9, phone-checklist 12, sync-api 6.

## 6. Open items
| Priority | Item | Doc/code reference | Next action | Done when |
|---|---|---|---|---|
| P0 | Apply `desktop-sync` 2.1–5.3 | `openspec/changes/desktop-sync/tasks.md` | fresh Sonnet agent(s): desktop secrets/settings, sync engine, UI, D89, smoke harness, setup guide | 11/11 ticked; smoke covers sync; archived |
| P0 | Redeploy the web | `docs/web/STATUS.md` item 0 | owner: `npm run deploy:web` | phone shows site icons; API still OK |
| P1 | Service tokens per PC + `SERVICE_TOKEN_IDS` | `docs/desktop/general/sync-setup.md` (written in task 5.2) | owner, after 2.x lands | both PCs show "synced" |
| P1 | Deferred manual checks | `docs/desktop/STATUS.md` (list) / `docs/desktop/general/manual-checks.md` | owner when convenient (D106) | each section ticked |
| P1 | Layout race D131 | `apps/desktop/ui/app.js` focus handler | skip the save when the pane is already focused | `resetSingle()` smoke workaround removed, smoke green |
| P2 | Sign-in redirect known issue D109 | `CLAUDE.md` D109 | investigate UA-dependent redirect handling | default UA signs in |
| P2 | Movable "Default" section (KIV) | D112 | revisit if wanted | — |
| P2 | GitHub Actions secrets + first CI run | `docs/web/STATUS.md` item 1 | at the MVP, when the owner commits | deploy workflow green |
| P2 | `/security-review` before the first push | global rule | run when committing starts | review clean |

## 7. Architecture / model changes
- **Item:** `Item.userAgent` (D70).
- **Workspace:** `Workspace.ungroupedLabel` (D99) with `validateWorkspace` and `ungroupedLabelOf`.
- **Core deletion:** `removalPlan` (D92), placed in the PWA and the desktop (Law 6).
- **Auth:**
  - the identity is the owner email (JWT or `ctx.access`) or `{serviceToken}` (D115);
  - reason codes extended.
- **Desktop-only state:** `listWidth`, icons in `data\icons`, and the return tracker. None are synced (D39).
- **Phone:** SW icon cache (D126), an explicit exception to D59.

## 8. Docs reconciled
| Doc | Change |
|---|---|
| `docs/STATUS.md` | roll-up: archived changes, in-flight `desktop-sync`, redeploy pending |
| `docs/web/STATUS.md` | redeploy item updated; service-token secret; stale archive item replaced |
| `docs/desktop/STATUS.md` | deferred checks; next = apply `desktop-sync`; D131 |
| `docs/{core,web,desktop}/{ARCHITECTURE,IMPLEMENTATION}.md` | reconciled per change by the implementers (reviewed) |
| `docs/web/general/service-tokens.md`, `docs/desktop/general/{manual-checks,spike-electron}.md` | new / updated |
| `CLAUDE.md` | D73–D131 + edge cases; D8 superseded |
| `~/.claude/CLAUDE.md` (global) | public-ready rule incl. "never name services I use" |

## 9. Drift check
`drift-check.ps1` against a throwaway temp-repo copy (D64) → **0 dead / 321 refs**.

## 10. Files changed
- `apps/web/**` (auth, store, rows, migrations 0002/0003, PWA editor, icons, SW), `apps/desktop/**` (whole shell + polish)
- `packages/core/**` (`userAgent`, `removalPlan`, workspace validation, example SEED)
- `scripts/**` (wrangler-config, gen-seed-sql, build-web, install-desktop)
- `openspec/**` (four archives, `desktop-sync`), `docs/**`, `CLAUDE.md`, `.gitignore`, `config/*.example.json`, `config/README.md`, `.claude/launch.json`
