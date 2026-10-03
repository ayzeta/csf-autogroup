# Changelog

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
