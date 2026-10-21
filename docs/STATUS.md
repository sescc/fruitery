# System status

> Roll-up of every <component>/STATUS.md. Detail lives in the linked file.

| Component | State | Headline gap | In flight | Detail |
|---|---|---|---|---|
| core | ✅ built | — | — (`core-model` archived 2026-10-14) | [core/STATUS.md](core/STATUS.md) |
| web | ✅ deployed (verified 2026-10-15; phone editing and service-token auth redeployed 2026-10-20) | redeploy for link rows in groups (D146) and offline ticks (D148); check the phone shows site icons; GitHub Actions not run yet | — (`phone-links-in-groups` and `offline-ticks` archived 2026-10-21, awaiting the redeploy; `desktop-sync` archived 2026-10-20); archived: `web-checklist`, `phone-editor` | [web/STATUS.md](web/STATUS.md) |
| desktop | ✅ built (local shell, polish, sync with the Worker, offline ticks; code complete) | the Worker redeploy for queued ticks; a second PC needs its own token; offline-tick manual check; four section-11 sync checks not run by hand; deferred manual checks | — (`desktop-sync` archived 2026-10-20, `offline-ticks` 2026-10-21); archived: `desktop-shell` (2026-10-16), `desktop-polish` (2026-10-20) | [desktop/STATUS.md](desktop/STATUS.md) |

## Cross-cutting
- **Spikes (throwaway; they decide risks before the shell is built):**
  - (a) Google sign-in in an Electron WebContentsView: done, see [desktop/general/spike-electron.md](desktop/general/spike-electron.md);
  - (b) the session-cookie persistence transform: done in the same note (quit-and-restart tested; the abrupt-shutdown test moves to the real app, D66: now a manual check in [desktop/general/manual-checks.md](desktop/general/manual-checks.md));
  - (c) Cloudflare Access + PWA install on Android: done 2026-10-15 on the real deployment (see [web/STATUS.md](web/STATUS.md)).
- The drift check resolves paths through `git ls-files`, so new files must be staged by the user
  before it can verify them.
