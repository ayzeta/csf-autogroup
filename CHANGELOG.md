# Changelog

## 1.9.15 — 2026-10-05

- A suspicious network warning sent earlier the same day, before a partial ban
  was added, no longer holds back a new warning: attacks that come in after the
  partial ban (e.g. on services it leaves open) are reported in the same run
  instead of the next day.
- **One period for the cards and the chart.** The 7 / 30 days choice moved above
  the summary cards and now sets both: each card's change is over the chosen
  period (block bans added minus removed, items flagged vs the period before,
  list fill vs N days ago). If the plugin is newer than the period, it says the
  comparison is since install.
- **Colors reworked: one meaning, one color everywhere** — badges, History icons,
  the IP card and the chart: red full ban, violet made permanent, teal temp ban,
  blue partial ban, amber suspicious network, gray whitelist skip. Indigo stays
  for buttons and tabs only. Before, a block ban was green in History, indigo
  in the chart and gray in the table, and partial and temp bans shared orange.
- **Activity chart redrawn**: value axis with dashed grid lines, slimmer bars,
  thin gaps between stacked parts, rounded only on top; types with no events in
  the period are dimmed in the legend. The day breakdown opens beside the bar
  so its date is never cut off.

## 1.9.14 — 2026-10-05

- **Partial bans on the web also block HTTP/3.** HTTP/3 (QUIC) runs on UDP
  443, which LiteSpeed (and newer Apache/nginx) can listen on; a web partial
  ban now blocks UDP 443 as well as TCP 80/443, and an exception that keeps the
  web (or outgoing web) open allows UDP 443 in both directions. Partial bans
  and exceptions added before this version get the missing line on the next
  run, once; History shows it as **Ban completed**.
- **Suspicious network warnings after a partial ban.** On a network with a
  partial ban, only bans added after it are counted. If they still reach the
  threshold, the warning says whether the blocked services were attacked again
  (with the command to check the rule is loaded) or other services were (a full
  ban may fit better). The old singles that led to the partial ban no longer
  repeat the warning, and such repeated warnings leave To review.
- **No more daily repeats with nothing new.** A network is reported again only
  when an IP came in that wasn't in its last warning; until then it stays in To
  review.
- **Buttons no longer look unresponsive after an action.** Until the new state
  arrives, action buttons are dimmed and a "Done, updating the list…" note
  shows; then the buttons come back with the right labels (e.g. **Change ban**).
- Whitelist notes name the file an entry really comes from when `csf.allow`
  includes it, e.g. `csf.allow → imunify360.txt: 139.59.43.2` (Imunify360's
  static whitelist), so it can be found.
- `tests/durum-tablosu` also checks the engine: UDP 443 lines, exceptions, the
  one-time upgrade and the warning after a partial ban.

## 1.9.13 — 2026-10-04

- **No more ban buttons that would change nothing.** A country or ASN ban
  (`CC_DENY`) now counts as covering: the IP card no longer offers to ban the
  block (or the network, when the announced prefix spans it), and the ban
  dialog says the range is already blocked by `CC_DENY`.
- History follows the same rules as the IP card and Overview: an item inside a
  range banned by another source, or inside a country ban, gets no ban buttons;
  an IP inside a banned block still offers **Ban network (/16)**; a block with a
  temp ban offers **Ban the block permanently (/24)** and, if it is watched,
  **Make permanent**.
- The ban button for a block with a temp ban now says **Ban the block
  permanently (/24)**.
- New `tests/durum-tablosu/calistir.sh`: prints which actions each screen offers
  in every ban state and checks them against rules (see README, Development).

## 1.9.12 — 2026-10-04

- **History rows have actions.** Each row gets a **⋯** menu with what can be
  done with that item now — based on its current state, not on the old record:
  ban, change ban, remove, make permanent, stop watching, ignore, **Show in
  Overview** (opens and highlights the row there) and the IP card. The newest
  row of each item says its current state ("banned now", "inside the … ban",
  "in To review", "watched", "no longer banned").
- **Since your last visit → Show** goes straight to the item in Overview when
  everything new is about one item that is still there; otherwise to History.
- With a partial ban in place, ban buttons say what they do: **Change ban**
  for the same range (opens with the current partial ban), **Ban the whole
  block (/24)** for a block inside a partially banned network. A suspicious
  network warning older than the partial ban added for it leaves To review; a
  new warning after it shows up again with a note.
- To review: the attacked services and the single-block suggestion come before
  the owner name, so they stay visible when the line is cut.

## 1.9.11 — 2026-10-04

- Ban reasons marked `(PERMBLOCK)` — LFD making an IP permanent after too many
  temp bans — are counted as "banned repeatedly" instead of an unknown reason.
  They name no service, so they no longer hold back the partial-ban suggestion
  (e.g. a network attacked only on the web, where some IPs were also escalated
  by LFD, now gets the "only Web" suggestion).

## 1.9.10 — 2026-10-03

- **Suggestions from the range's own attacks.** The service buttons of the ban
  window show how many IPs of the range attacked each service, read from the
  ban reasons LFD wrote (single bans, temp bans and the recorded IPs of the
  block bans inside; e.g. "(sshd) … [LF_SSHD]" → SSH). **Selected services**
  preselects only the services that were attacked, and says so; with no
  recorded reasons nothing is preselected. Port scans suggest "Everything".
  **Everything except** preselects nothing and warns when a service you keep
  open was attacked from the range. (Before, a fixed set was preselected.)
- **More suggestions from the data already collected:**
  - Ban window, *Everything*: when the attacks from the range only hit one or
    two services, it suggests a partial ban that blocks just those (one click
    switches to *Selected services*).
  - Remove ban window: when and why the ban was added; for a partial ban, new
    bans that came from the range to other services since then, with a
    **Change ban** shortcut.
  - IP card → **Block status**: how many single / temp bans the IP's block has
    and how many more until it is banned automatically.
  - Settings → Thresholds: changing a threshold shows how many more blocks (or
    networks) the current entries would ban or report at the new value.
  - To review, suspicious networks: which services were attacked, and when most
    singles sit in one block, a suggestion and a button to ban just that block.
- **Suspicious networks count permanent and temp single bans together** (each IP
  once). A network attacked through both lists — e.g. 2 IPs LFD made permanent
  and 4 temp-banned ones, each below the threshold on its own — is now reported.
  The warning, To review and History show the split ("2 permanent · 4 temp").
  The separate temp threshold (`THRESHOLD_TEMP_16`) is gone; `THRESHOLD_16`
  covers both. /16 networks are still never banned automatically.
- The "entries removed" and "entries restored" counts of a manual ban now
  include the partial bans inside it (a split partial ban counts once); before,
  only single and range bans were counted.

## 1.9.9 — 2026-10-03

A review of the manual ban features added in 1.9.7–1.9.8.

- **Large bans no longer time out.** Covered entries are removed in one locked
  rewrite of `csf.deny` and one `csf -r` (instead of one `csf -dr` each), and the
  restore copy is written before anything is removed. Restoring works the same
  way. The steps are ordered so an interruption never leaves a range open or
  loses saved entries.
- **Files without a final newline:** a line added to `csf.allow` or `csf.deny`
  could stick to the previous line's comment, and removing it later could take
  that line with it. Every write now keeps lines separate.
- A wider ban now also removes (and saves) the allow rules and partial bans of
  CSF Auto-Group bans inside it; before, their ports could stay open.
- "Everything except" bans keep their **other ports**: shown in Active block
  bans, the IP card and History, and kept by **Change ban**.
- A failed write is reported as an error instead of success; Change ban writes
  the new state before removing the old one.
- Restoring keeps entries that could not be put back instead of losing them;
  an old restore copy is never attached to a new ban.
- Restored automatic block bans don't count the time spent under the manual ban
  toward their age, so "remove old block bans" doesn't delete them right away.
- Leftovers of manual bans removed outside the plugin (e.g. in the CSF UI) —
  restore copies and allow rules — are cleaned up on the next run.
- **List usage now counts like CSF:** lines marked "do not delete" don't count
  toward `DENY_IP_LIMIT` (CSF skips them), so the usage shown is the real one.
  The ban window's "lines freed" follows the same rule.
- Switching a full ban to partial is recorded as **Ban changed** (with the
  number of restored entries), not as a new ban.
- A suspicious network with a partial ban says so in To review and in the
  warning email.
- Manual bans no longer weigh as attack evidence in **Most blocked providers**.
- The `/16` whitelist check is bounded (at most 30 blocks and 30 reverse-DNS
  lookups), so the window opens quickly even for busy networks.
- **History → Since your last visit** lists everything since then, removals and
  changes included (it used to show a ban but not its removal).
- Panel texts: the new windows use the same polite form as the rest of the
  plugin; partial bans get their own removal text; English uses "network" for a
  `/16` (e.g. *suspicious network*, *Ban network (/16)*) and "range" only in the
  general sense. Narrow screens: the mode buttons wrap instead of overflowing.
- Command line: actions refuse `--dry-run` instead of partly writing.

## 1.9.8 — 2026-10-03

- **What to block** in the manual ban window (`/24` and `/16`): **Everything**,
  **Selected services** (only connections from the range to Web, SSH, FTP,
  cPanel · WHM · Webmail, incoming mail, mail sync, DNS or any other ports and
  ranges are blocked) or **Everything except** (a full ban that keeps the chosen
  services open, outgoing mail and outgoing web included).
- Partial bans are written as port-limited `csf.deny` lines and shown as
  *partial* in Active block bans (with a **Partial** filter), on the IP card and
  in History; they don't cover the range, so nothing inside is removed.
- "Everything except" adds two-way allow rules to `csf.allow` for each service
  (CSF drops replies from a banned range otherwise), including FTP's passive
  port range; they are removed together with the ban.
- The window explains dependencies between services: mail and web may need DNS
  when this server hosts the DNS for its domains; cPanel addresses such as
  `cpanel.example.com` go through the web port.
- **⋯ → Change ban** for CSF Auto-Group bans: change the open services, switch
  full ⇄ partial (switching to partial restores what the full ban removed).
- SSH is offered on this server's real SSH port.
- A **Blocked / Stays open** summary under the choices says in plain words what
  the selection does.
- **Fix:** a manual `/16` ban now runs the same whitelist checks as a `/24`:
  besides overlapping entries, the blocks inside with single bans are checked
  against `CC_IGNORE` / `CC_ALLOW` and `csf.rignore` (e.g. Googlebot).
- New command-line options: `--mode all|svc|exc`, `--svc`, `--ports`, `--replace`.

## 1.9.7 — 2026-10-03

- **Ban a /16 from more places:** **⋯ → Ban range (/16)** in Active block bans
  and Watched, and **Ban block (/24)** / **Ban range (/16)** on the IP card.
- **One ban window for /24 and /16:** before banning it lists what is inside the
  range (block bans, single bans, temp bans, watched blocks, other ranges,
  port-limited rules), what happens to each, and any whitelist overlap.
  **Remove covered entries** (on by default) clears every permanent entry inside
  (`do not delete` ones and other ranges included) and the temp bans, and says
  how many lines each list frees. The removed IPs and reasons are kept with the
  new ban, and History shows how many entries were removed.
- **Undo:** the removed permanent entries are saved. Removing the ban later
  offers **Restore the N entries removed when this ban was added**, which puts
  them back exactly as they were (comments, dates, `do not delete`). Temp bans
  are not restored.
- A range containing one of this server's own IPs can no longer be banned, not
  even with "Ban anyway".
- **IP card:** shows every level at which CSF blocks the IP (single, `/24`,
  `/16` or other range, port-limited rules, `CC_DENY` / `CC_DENY_PORTS` country
  or ASN) instead of only the first covering range.
- Blocks inside a wider ban are tagged *inside /16* in Active block bans and
  Watched; a watched block inside one no longer offers "Make permanent".
- **Fix:** a port-only rule in `csf.allow` that opens a port to everyone (e.g.
  `tcp|in|d=80|s=0.0.0.0/0`) was read as "the whole internet is whitelisted",
  which stopped all block bans. Such rules are now port rules, not whitelist
  entries; port rules for a specific address still protect it.
- **Fix:** manually banning a `/24` with no single bans in it could fail the
  `CC_IGNORE` / `CC_ALLOW` check.
- New command-line mode: `--inside A.B.0.0/16|A.B.C.0/24` shows what a manual
  ban would cover; `--action ban16|ban24 … --keep` bans without removing the
  covered entries; `--action unban CIDR --restore` restores them.

## 1.9.6 — 2026-10-02

- **History** and **Settings → Settings history** reach back to the start of
  the event log. They used to see only the latest 300 entries; now the latest
  300 load first, **Show more** loads the page before, and new entries are
  added on each refresh. Entries that share a second at a page edge are never
  lost or shown twice.
- The page's status data no longer carries the IP lists of the latest events,
  so it loads lighter. IP lists come with the History pages; active and
  watched blocks still get theirs from their own ban records.
- New command-line mode: `--events latest|after|before [TIME] [N]` prints a
  page of the event log as JSON.

## 1.9.5 — 2026-10-02

- Removed fetching IPs from the LFD log ("IPs" on blocks older than the event
  log, the `--history` mode and its cache). Every ban is recorded in the event
  log with its IPs and reasons, so a fresh install never needs it; it only
  served blocks left over from versions before the event log. Those now show
  without IPs, and the IP card says when a watched block's reason isn't
  recorded. The `LFD_LOG` setting is no longer used.

## 1.9.4 — 2026-10-02

- "IPs" (fetching a block's IPs from the LFD log) is offered only for dates the
  LFD log still covers; for older blocks it used to end in "no records left in
  the LFD log". This only affects installs upgraded from versions before the
  event log; fresh installs record every ban with its IPs and reasons.

## 1.9.3 — 2026-10-02

- The reason line under each Watched block is removed again (it made the table
  busy). **Why a block is banned or watched** is shown where you look it up:
  **⋯ → IPs** lists the IPs and reasons, and the IP card shows the covering
  block's state, date and main ban reason (and the IP's own reason).
  When the reason of a watched block isn't recorded (watched since before the
  event log started), the IP card says so instead of showing only the date.
- The ban records of older active and watched blocks are now read too (the
  page used to read only the latest 300 entries of the event log), so their
  IPs show up without going back to the LFD log.
- **Most blocked providers → CSF** shows each provider's most common ban reason,
  like the Imunify tab does.

## 1.9.2 — 2026-10-02

- **Update check:** Settings → Server asks GitHub right away when its result is
  older than two minutes; "Last checked" shows when GitHub was really asked; the
  "Update available" banner appears without reloading the page, even while a run
  is in progress or settings are unsaved.
- **Watched:** each row says why the block is watched (temp block ban: number of
  IPs and the most common ban reason); the IP card shows it too.
- A row's ⋯ menu opens upwards when there is no room below (last rows of a
  table no longer get cut off).
- The hover underline of an address is only as wide as the address.

## 1.9.1 — 2026-10-02

- Same elements behave the same everywhere:
  - every state badge explains itself on hover (Active block bans, To review,
    History), including what "do not delete" and "repeating" mean;
  - the button that fetches older IPs from the LFD log is called **IPs**
    everywhere (it was "Details" in To review and History);
  - addresses in Ignored open the IP card like everywhere else;
  - relative times ("5 d ago") show the full date on hover.

## 1.9.0 — 2026-10-02

### Notifications
- **HTML emails.** Alert emails, the weekly summary and the test email are now
  HTML (cards and tables, the plugin icon embedded) with a plain-text part.
  Built to render in desktop Outlook as well as Gmail and Apple Mail. Sent
  through `sendmail`; servers without it fall back to plain text via `mail`.
- **Slack.** Firewall problems, list usage, run notices and the weekly summary
  can go to the Slack address set in WHM. The address is read from WHM at send
  time and never stored by the plugin. Messages look like WHM's own (coloured
  card: red for problems, orange for the temp list, green when resolved).
  Urgent ones go right away (once when they start, once when resolved); run
  notices are collected into at most one message per hour.
- **Notification channels** setting: all channels set in WHM (email + Slack,
  default), email only, or Slack only. Nothing arrives twice.
- **Alert email address** can follow WHM's contact address (`ALERT_MAIL=whm`,
  the new default).
- The weekly summary shows emails and settings changes separately, adds the
  owner, IP count and main ban reason to new block bans and watched blocks, and
  explains the expected run count.

### Plugin
- **⋯ → IPs** on every active block ban and watched block: the IPs and ban
  reasons behind it; for older bans fetched once from the LFD log and kept.
- **ModSecurity ban reasons** show the rule's message
  (`ModSecurity 1302: WP LOGIN VIEW RATE LIMIT…`), from cPanel's hit log
  (`sqlite3`) or the rule file.
- Temp block bans show their time left in the state badge; the *Added* column
  means the same thing for every row.
- Settings history has filters; History rows open the IP card from the address.
- Summary cards stay in four columns inside WHM next to its menu; on phones, IP
  lists show the ban reason on a second line and the settings menu is aligned.
- Clearer texts throughout (both languages), a short glossary on the Rules card
  and in emails, and "Most blocked providers" instead of "Top attacking".

### Engine
- **Imunify360 whitelist** is respected: a `/24` containing an IP on the
  server's Imunify360 whitelist is skipped like a CSF whitelist hit.
- `csf.rignore` entries are matched like LFD does (as regular expressions), so
  entries such as `.*\.googlebot\.com$` now protect those IPs here too.
- Fixed: with Turkish selected, the email check rejected addresses containing
  "i" (Turkish locale ranges); dates and IP checks are locale-independent now.
- Fixed: on Bash 5.2+, `&` in text replacements broke HTML/Slack escaping.
- English messages use proper singular/plural ("1 block ban", "3 block bans").

### Installer
- Accepts `whm` and local addresses (e.g. `root`) for the alert email.

Earlier versions: see the git history.
