# Changelog

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
