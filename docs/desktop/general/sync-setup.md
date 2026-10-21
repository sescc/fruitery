# Desktop: connect a PC to sync

> How to give one PC an access key so its desktop app shares workspaces, items, settings and ticks with
> the phone and the other PCs. Do this once per PC. Cloudflare labels were checked against the
> developer docs on 2026-10-20 (sources at the bottom); a label marked "(unverified: label may differ)"
> was not stated there.
> Addresses below are placeholders: `https://fruitery.<your-subdomain>.workers.dev` is your Worker and
> `<team>.cloudflareaccess.com` is your Zero Trust team.

## What you are setting up
- Each PC gets its **own service token** (a Client ID and a Client Secret). The desktop app cannot use
  the Google or email login the phone uses, so it sends the token with every request instead.
- Access checks the token against a **Service Auth** policy. The Worker then checks that the token's
  Client ID is in its own allow list (`SERVICE_TOKEN_IDS`). Both must agree.
- One token per PC means a lost or retired PC is cut off alone, without touching the others.

## 1. Create a service token (one per PC)
1. In the Cloudflare dashboard open **Zero Trust**, then **Access controls**, then **Service credentials**,
   then **Service Tokens**.
2. Select **Create Service Token**.
3. Name it generically, for example `fruitery-pc1`, `fruitery-pc2`. The name only identifies the token
   in logs and in the list.
4. Under **Service Token Duration** choose **1 year**. The list also offers longer durations (up to 10 years),
   **Non-expiring** and **Custom**. One year is recommended: a copied or leaked secret stops working within a year,
   renewal takes a few minutes per PC, and Fruitery warns 14 days ahead. Two or three years is acceptable if yearly
   renewal is a burden. Avoid non-expiring: nothing ever forces a rotation, and Fruitery's expiry warning needs a date.
5. Select **Generate token**.
6. Copy the **Client ID** and the **Client Secret** now. The docs say the secret is shown only this once;
   if you lose it you must generate a new token.
7. Write down the expiry date. You will enter it in Fruitery so the app can warn you.

## 2. Let the token through Access (Service Auth policy)
1. Zero Trust, **Access controls**, **Applications**. Find the Access application that protects the
   Fruitery Worker (it is the one created when you turned on Access in the Worker's **Access** tab; its
   name is unverified: label may differ) and select **Configure**.
2. Open its **Policies** section and add a policy. You can create a reusable one first under
   **Access controls**, **Policies**, **Add a policy**: give it a **Policy name**, set **Action** to
   **Service Auth**, choose a **Session duration**, and under **Rules** pick the **Service Token**
   selector with your token (field labels inside the rule builder are unverified: label may differ).
3. **Keep your existing Allow policy** for your own logins. Do not edit or remove it.

Which selector to use:
- **Service Token** (a specific token) is safer. Only the named token passes, and you can add one rule
  per PC.
- **Any Access Service Token** lets in every service token in your Cloudflare account, including ones
  made for other things. It is easier but wider. The Worker's own allow list (step 3) would still stop
  unlisted tokens, but prefer the specific token.

The action must be **Service Auth**. With any other action Access asks for a login and the desktop app
is turned away (it shows "access key refused").

## 3. Tell the Worker which tokens are allowed
The Worker has a secret named `SERVICE_TOKEN_IDS`: a comma-separated list of **full Client IDs**, exactly
as the dashboard shows them (including any suffix such as `.access`). They are compared exactly and are
case-sensitive; spaces around a comma are ignored. An email address in this list never matches.

Set it from the repo, using the same generated config the other remote commands use:

```
npm run wrangler:config
npm exec -w apps/web -- wrangler secret put SERVICE_TOKEN_IDS --config .local/wrangler.toml
```

Paste the list when asked, for example `<client-id-of-pc1>,<client-id-of-pc2>`. Wrangler needs to be
logged in on the machine you run it from. Or use the dashboard: **Workers & Pages**, your Worker,
**Settings**, **Variables and Secrets**, **Add**, type **Secret**, name `SERVICE_TOKEN_IDS`, then
**Deploy**.

Notes:
- Changing a secret takes effect on its own. The `wrangler secret put` command deploys the new version
  itself; no `npm run deploy:web` is needed for it.
- The Worker code that understands service tokens must be deployed once. The owner deployed it on
  2026-10-20, so there is nothing more to do on that side. After a later code update on another machine,
  run `npm run deploy:web` there as usual.
- `SERVICE_TOKEN_IDS` replaces the whole value each time. Always paste the full list.

## 4. Connect the PC in Fruitery
1. Open Fruitery, then **Settings** (the gear icon), then scroll to the **Sync** section.
2. Fill in:
   - **Worker address**: `https://fruitery.<your-subdomain>.workers.dev`. It must start with `https://`,
     with no path, no user name and no `?` or `#`.
   - **Client ID** and **Client secret** from step 1. The secret field is never filled in afterwards;
     Fruitery says "Stored" instead.
   - **Expiry date**: the token's expiry. It is optional, but recommended: it shows a warning 14 days
     before the key stops working.
3. Select **Test connection**. This saves what you typed, then asks the Worker for the current state.
   Then **Save** in the Settings dialog if you changed other settings too.

The secret is encrypted for your Windows user and stored in `data\sync-secret.bin` next to the app.
It is never shown again, never sent to the app's window, and goes only to the Worker address you entered.
A data folder copied to another PC or Windows user cannot decrypt it, so that copy asks for the key again.

### What the messages mean
| Message | Meaning | What to do |
|---|---|---|
| Connected | The Worker accepted the key | Nothing |
| `access-key-refused` | Access sent a redirect to its login page instead of letting the key in. Access answers a wrong Client ID or secret with HTTP 401 (seen on the real deployment 2026-10-20); a redirect means the same | Check the Client ID and secret (a secret cannot be recovered; rotate or create a new token), that the token is not deleted, disabled or past its expiry, and that a **Service Auth** policy includes this token (step 2) |
| `service-token-not-allowed` | Access accepted the token, but its Client ID is not in `SERVICE_TOKEN_IDS` | Add the full Client ID to the list (step 3). Check for a typo or a different letter case |
| `service-token-ids-missing` | The Worker has no `SERVICE_TOKEN_IDS` secret at all | Set it (step 3) |
| offline | The Worker cannot be reached | Check the address and your connection. Edits are kept and sent later |
| `http-<number>` | The Worker answered with an error status | Try again later; if it stays, check the Worker in the dashboard |
| another reason code (for example `email-mismatch`, `jwt-config-missing`) | The Worker's own check refused it. The code names the check, never a secret | Report the code; the Worker's setup is incomplete (see `docs/web/STATUS.md`, "Diagnosing a 403") |

### The sync chip
A small status chip sits at the bottom of the workspace rail. Hover it for the text, click it to open
Sync settings (or the "Needs attention" list when changes were refused).
- **Synced** with the time of the last sync.
- **Syncing** while a round is running (a very short one is not shown).
- **Offline**: edits and ticks are kept and sent later (see "Ticks while offline" below).
- **Not connected**: no usable key on this PC. Enter it in Settings, Sync.
- **Access key expires in N days** (or **today**): from 14 days before the expiry date you entered. Sync
  keeps working. Renew now (see "Renewing").
- **Access key expired**: after the expiry date. Sync and ticking stop (nothing could send a tick). Edits stay local and queue up.
  Renew the key.
- **Sync error: `<reason>`**: the Worker refused the key; the reason is one of the codes above.

A change the server rejects as invalid (for example a field it does not accept) stays on this PC and
appears under **Needs attention**: **Fix** opens the editor, **Discard** drops it and loads the server's
version. A tick the Worker refused also appears there (**Dismiss** only).

### Ticks while offline
A tick or an untick made with no connection (or while sync is in an error) is applied at once: the circle shows
it ticked with a dashed "waiting" ring, and Done moves on as usual. It is kept in the data folder and sent when the
connection returns, filed under the day you made it on (the Worker decides the day itself from the time the tick
was made, in your timezone and with the item's reset time). Rules:
- A tick older than 48 hours, or one the Worker cannot place, is not accepted. It is dropped, its circle goes
  back to unticked, and **Needs attention** lists it ("Tick dropped: ...") with **Dismiss**. The list also
  counts on the chip badge.
- If this PC's clock is off, the time of a queued tick is corrected by how far the Worker's clock differed at the
  last sync.
- An expired or unreadable key cannot send anything, so it still refuses ticking (with a notice).
- **If the Worker has not been redeployed with this feature yet**, queued ticks wait: nothing is sent and
  nothing is lost, and **Needs attention** says "Queued ticks wait for a Worker update (npm run deploy:web)".
  Run `npm run deploy:web` once; the next sync releases the queue. Ticks made while online are unaffected.
- The phone still needs a connection to tick.

## 5. What happens the first time a PC connects
1. Fruitery writes a backup of this PC's lists first, as `cache.pre-sync-<time>.json` in the data folder
   (`<install folder>\data`). Keep or delete it as you like.
2. Edits that are **newer** than the server's copy are kept and sent. Anything the server has newer
   replaces the local copy. The newest save of each workspace, group, item and setting wins.
3. Ticks you made locally in the current periods are sent to the server.
4. From then on the server's tick history is used, and the server's clock decides the periods.

The first connect happens once per Worker address.

## 6. Renewing a key before it expires
Do this while the old key still works, so sync never stops:
1. Create a new service token for the PC (step 1) and make sure a **Service Auth** policy covers it
   (step 2; skip if you used **Any Access Service Token**).
2. Add the new Client ID to `SERVICE_TOKEN_IDS` **next to** the old one (step 3).
3. In Fruitery, Settings, Sync: enter the new Client ID, the new secret and the new expiry date, then
   **Test connection**. A new Client ID needs the secret typed again.
4. Remove the old Client ID from `SERVICE_TOKEN_IDS`, and delete the old token in Zero Trust.

Alternatives in Zero Trust: **Refresh** on the token extends it by one year without changing the Client
ID or secret (then only update the expiry date in Fruitery); **Rotate secret** keeps the Client ID, issues
a new secret and lets you keep the old one valid for a grace period from one hour to 30 days. After
either, enter the new expiry date (and the new secret, after a rotation) in Fruitery.

## 7. A lost or retired PC
1. In Zero Trust, **Service Tokens**, **Delete** that PC's token. The docs state that only deleting a
   service token revokes its access; clicking "Revoke existing tokens" on the application does not stop a
   new session.
2. Remove its Client ID from `SERVICE_TOKEN_IDS` (step 3). Keep the other PCs' ids.
3. If the PC held a copy of your data you do not want others to see, the lists on it stay readable on
   that PC. The key itself is encrypted for that Windows user.

## 8. Disconnect
**Settings, Sync, Disconnect** (after a confirmation) deletes the stored key from this PC and clears the
Client ID and expiry date; the Worker address stays. Nothing is deleted on the server and nothing on this
PC's lists: your edits stay local. The next time you connect, it is a first connect again (section 5),
with a new backup. Disconnecting does not revoke the token; to do that, delete it in Zero Trust (section 7).

## 9. "Start this program?" (program confirmation)
Items can start a program on a PC (a program path set on the item). Items now sync, so an item made on
another device could point at a program on this PC. The first time an item would start a given program
here, Fruitery shows a box "Start this program?" with the full path:
- **Start** launches it and remembers that exact path on this PC. Case and slash differences do not
  matter. It will not ask for that path again.
- **Don't start** (also what Esc does) launches nothing and opens the item's fallback address in a pane if
  it has one; otherwise nothing opens.

Approvals are kept per PC only, in this PC's `device.json`; they are never synced and cannot be changed
from the app's window. A program that is missing on this PC opens the fallback address with no question.
Opening an item in a split pane never starts a program.

## Sources (checked 2026-10-20)
- Service tokens (create, duration, shown once, refresh, rotate, delete, headers, Service Auth action):
  https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- Access policies (actions Allow, Block, Bypass, Service Auth; selectors Service Token and Any Access
  Service Token): https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
- Policy management (Zero Trust, Access controls, Policies, Add a policy; attaching a policy to an
  application): https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/
- Access for a Worker (the Worker's Access tab, service tokens reaching `ctx.access`):
  https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Worker secrets (dashboard Variables and Secrets, `wrangler secret put` deploys at once):
  https://developers.cloudflare.com/workers/configuration/secrets/
- What the Worker reads from a service-token request: `docs/web/general/service-tokens.md`
- Service Token Duration options confirmed in the dashboard by the owner, 2026-10-20.

## Not verified in the docs
- The exact name and layout of the Access application for a Worker-level Access setup, and the field
  labels inside the policy rule builder.
- Whether the Worker-level Access screen shows the Service Auth policy next to the existing Allow policy
  without extra steps. The real deployment's reason codes (section 4) show the outcome.
