# Changelog

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
