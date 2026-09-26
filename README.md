# CSF Auto-Group

Turns a scatter of single-IP bans into **subnet bans** for **ConfigServer
Security & Firewall (CSF)** — stopping distributed attacks automatically instead
of playing whack-a-mole one IP at a time.

Most floods come from the same neighbourhood: when 3–5 already-banned IPs pile
up in a single `/24`, the rest of that range is almost always the same attacker
still coming. So the script bans the **whole `/24`** and drops the singles — the
attack is blocked **before you have to touch anything**. If that range comes back
later it's escalated to a **permanent** ban. `/16` ranges are only flagged for
review by email (never auto-banned — too broad).

A useful side effect: folding singles into ranges also keeps `csf.deny` from
overflowing its line limit, and you get an email when it nears that limit.

Works on **any CSF server** (cPanel or not). No dependencies beyond CSF and a
working `mail` command (`dig` or `host` for the optional lookups below).

**Version 1.6.4** · bilingual logs, alert emails and WHM plugin (English /
Türkçe, set `MSG_LANG`). The running version is printed on each run's first log
line.

On cPanel servers the installer also adds a **WHM plugin** (root only) that
shows what the script is doing and lets you act on it — see
[WHM plugin](#whm-plugin).

---

## ⚠️ Read this first

This script **modifies your firewall** — it auto-bans entire `/24` subnets (256
addresses). A misconfigured threshold, or a legitimate visitor whose IP falls in
a banned `/24`, can lock people out.

- **Whitelist your own IPs** in `/etc/csf/csf.allow` (CSF allow overrides deny).
  The script also refuses to ban a `/24` that touches any CSF whitelist — see
  [Whitelists](#whitelists).
- **Start with high thresholds** and watch `/var/log/csf_autogroup.log` for a
  few days before trusting it.
- `/16` is warn-only by design; only `/24` and single IPs are auto-banned.

## What it does

The escalation ladder — a few bad singles in a range turn into a range ban, and
a range that comes back turns into a permanent one:

| Trigger | Action |
|--------|--------|
| `/24` with **≥3** permanent single bans | permanently ban the `/24`, remove the singles |
| `/24` with **≥5** permanent singles | ban `/24` + `do not delete` |
| `/16` with **≥5** singles across **≥2** `/24`s | warn by email (once/day) — no auto-ban |
| `/24` with **≥3** temp bans (first time) | temp-ban the `/24` for 12h, remember it |
| same `/24` seen again | promote to permanent ban + `do not delete` |
| temp `/16` with **≥5** singles / **≥2** `/24`s | warn by email (once/day) |
| deny list **≥80%** of its limit | email alert |

Temp bans already covered by a permanent block are cleared, the counter is
pruned (default 180 days), and the log is capped (default 5000 lines). Singles
marked `do not delete` are never removed. A `/24` that is already covered by a
broader block in `csf.deny` (a `/22`, `/16`, …) is left alone.

## Who is it? — owner info in the emails

Every alert email tells you who you are dealing with, so you don't have to look
each IP up on ipinfo & co. by hand:

```
185.220.101.0/24 -> 4 permanent singles, permanent ban
   Owner: AS60729 ARTIKEL10, DE
   - 185.220.101.12   berlin01.tor-exit.artikel10.org  (sshd) Failed SSH login
   - 185.220.101.47   tor-exit-47.artikel10.org  (smtpauth) Failed SMTP AUTH login
```

- **Owner** — ASN, organisation and country of the block, from
  [Team Cymru's](https://www.team-cymru.com/ip-asn-mapping) free DNS service
  (no account or API key).
- **Hostname** — each IP's reverse DNS (`-` when it has none).
- **Reason** — why lfd banned it, taken from the ban's own comment.

`/16` warnings show the ASN and country on every line, since those IPs can
belong to different networks. Lookups use plain DNS queries (`dig` or
`host`) with a short timeout. Set `LOOKUP=0` to turn them off.

## Whitelists

Before banning a `/24` (permanent or temp), the script checks it against every
list CSF uses to say "don't block this". If **any** entry overlaps the `/24`,
nothing is banned, the singles stay as they are, and you get one email a day
naming the entry that matched:

| Source | What is checked |
|--------|-----------------|
| `csf.allow` (+ `Include`) | IPs, CIDRs, advanced rules (`tcp\|in\|d=22\|s=IP`), hostnames |
| `csf.ignore` (+ `Include`) | IPs and CIDRs |
| `GLOBAL_ALLOW`, `GLOBAL_IGNORE`, `DYNDNS`, temp allows (`csf -ta`) | CSF's cached lists in `/var/lib/csf` |
| Server's own IPs | a `/24` containing one of this server's addresses |
| `CC_IGNORE`, `CC_ALLOW` in `csf.conf` | the block's country code or `ASnnnn` |
| `csf.rignore` | a banned IP whose reverse DNS matches (forward-confirmed, like lfd) |

This matters most for `csf.ignore`: CSF lets `csf.allow` addresses through even
inside a banned range, but `csf.ignore` only stops lfd — a `/24` ban would block
those addresses.

If a `CC_IGNORE` / `CC_ALLOW` / `csf.rignore` check can't be completed because
DNS isn't answering, the block is **not** banned on that run and is retried on
the next one. `/16` warnings mention a whitelisted address inside the range.

## WHM plugin

On a cPanel server, `install.sh` (and therefore `update.sh`) installs a page
under **WHM → Plugins → CSF Auto-Group**. Only `root` and WHM accounts with the
`all` privilege can open it. Resellers can't.

What it shows:

- **Overview** — deny-list usage, active group bans, items to review, last run.
  The header turns red when the last run is much older than the cron interval.
- **Since your last visit** — what happened since you last opened the page;
  new rows carry a dot.
- **Last 30 days** — a daily chart of group bans, blocks made permanent, temp groups,
  `/16` warnings and whitelist skips. Days before the event log existed are
  filled from the dated records in the counter file and `csf.deny`.
- **To review** — `/16` warnings and whitelist-skipped `/24`s from the last 7
  days, with every IP's hostname, owner and ban reason (older items recovered
  from the counter file are listed without IP details).
- **Active group bans** — a sortable, paged table with each block's owner
  (ASN, organisation, country), searchable by CIDR, AS number or organisation.
  Each filter shows its count.
  Blocks that became permanent on a second attack are tagged *repeat*.
- **Watched** — `/24`s that were temp-banned once. If one comes back, it
  becomes permanent + `do not delete`. A paged table under the group bans,
  sorted by days left; ones about to expire are highlighted.
- **Top attacking networks** — three tabs:
  - *Attackers* — ranked by attack evidence: *groups* (bans CSF Auto-Group
    added) and *singles* (IPs lfd caught). A network with 5+ group bans — at
    least 15 attackers in 5 separate `/24`s — gets a suggestion explaining how
    to block the whole ASN with CSF's own `CC_DENY`; networks already in
    `CC_DENY` are marked instead. The plugin never edits `csf.conf`.
  - *Other blocks* — ranges in `csf.deny` added outside CSF Auto-Group (by hand
    or by other tools), per network.
  - *Imunify* (only when Imunify360 is installed) — networks in Imunify360's
    **own** blacklist on this server (`ip-list local list --purpose drop`; the
    cloud list is not used), with the block reasons (e.g. `CAPTCHA_DOS_ALERT`).
    Read-only: nothing from Imunify is turned into a CSF ban. Imunify IPs get
    their own lookup budget (200 per run), so owners fill in within a few runs.
- **Recent actions** — every ban, promotion, skip, warning and manual change.

Owner info comes from a cache (`/var/lib/csf_autogroup/owners`, 30 days). Each
run looks up at most 50 blocks that aren't cached yet, so older bans fill in
over a few runs.
- **IP lookup** — hostname (forward-confirmed), owner (ASN), announced prefix,
  registry, whether CSF blocks it and which list whitelists it, with links to
  bgp.he.net and AbuseIPDB.

What you can do from it — each action asks for confirmation, and risky ones
(banning a `/16`, overriding a whitelist, removing a `do not delete` block) make
you type the target:

| Button | Does |
|--------|------|
| Ban /16 | permanent `/16` ban, added as `do not delete` |
| Ban anyway | ban a whitelist-skipped `/24` (overrides the whitelist) |
| Make permanent | make a watched `/24` permanent right away |
| Stop watching | forget a watched `/24` (next attack counts as the first) |
| Remove | lift a group ban (`do not delete` blocks too; `csf.deny` is backed up first) |
| Ignore | hide an item from review for 7/30/90 days (stops `/16` warning emails too) |
| Dry run | show what a run would do — changes nothing, sends nothing |
| Run now | run immediately instead of waiting for cron |
| Update | runs `update.sh` when GitHub has a newer version |

Every manual action is written to the log as `MANUAL (user): …` and shows up in
the recent actions list.

Alert emails end with a panel line — `Panel: https://server:2087/ → Plugins →
CSF Auto-Group`. It is a plain WHM link: WHM session URLs expire, so they can't
be emailed, and WHM's login form ignores redirect parameters when two-factor
authentication is on. The address is detected automatically
(`https://$(hostname -f):2087`). Servers without the plugin get no link.

### Settings tab

The same settings as `config.env`, with validation:

- **Notifications** — alert email (with a *Send test email* button), language,
  and the **weekly summary**: sent with the first run after
  09:00 on the chosen day (default Monday) — new groups, top attacking
  networks, watched blocks about to expire, list usage and run count. Can be
  previewed from the page or with `--digest` (`--digest --send` emails it now).
- **Thresholds** — `/24` ban, `do not delete`, `/16` warning, temp `/24` and
  temp `/16`. The `do not delete` threshold can't be lower than the `/24` one.
- **Schedule** — cron every 5 / 10 / 15 / 30 minutes or hourly.
- **Lookups** — owner/hostname lookups on or off, DNS timeout.
- **Retention** — watch period, review days, log line limit.

*Try before saving* runs a dry run with the unsaved thresholds, so you can see
which `/24`s would be banned before committing to a change. Saving writes
`config.env` (comments kept, previous file saved as `config.env.bak`), updates
the crontab and `.install.conf` so `update.sh` keeps your choices, and logs each
change as `SETTING (user): KEY: old → new`.

CSF's own list limits (`DENY_IP_LIMIT`, `DENY_TEMP_IP_LIMIT`) are shown
read-only with a link to CSF. Change them there.

From the command line: `--config get`, `--config set KEY=VALUE …`,
`--config test-mail`, and `--dry-run --set KEY=VALUE` to try a value without
saving it.

The page never parses CSF files itself. It calls the script's command-line
modes, which you can also use over SSH:

```bash
./csf_autogroup.sh --status          # same data as the plugin page
./csf_autogroup.sh --dry-run         # what a run would do, changes nothing
./csf_autogroup.sh --lookup 1.2.3.4  # who is this IP?
./csf_autogroup.sh --help
```

## Install

```bash
git clone https://github.com/ayzeta/csf-autogroup.git
cd csf-autogroup
sudo bash install.sh
```

The installer asks for the language (`en`/`tr`), alert email, and cron interval,
writes `config.env`, and installs the root cron job. Re-run it any time.

## Updating

```bash
cd csf-autogroup
sudo bash update.sh
```

`update.sh` pulls **only if the GitHub remote is ahead**, then reinstalls
non-interactively with your saved settings — no prompts, and your `config.env`
(thresholds, language, email) is left untouched. Prints "Already up to date"
when there's nothing new. (Equivalent to `git pull` + `sudo bash install.sh --yes`.)

### Manual install

```bash
cp config.env.example config.env      # edit ALERT_MAIL, MSG_LANG, thresholds
chmod 700 csf_autogroup.sh
( crontab -l 2>/dev/null; echo '*/10 * * * * /path/to/csf_autogroup.sh >/dev/null 2>&1' ) | crontab -
```

## Configuration

All settings live in `config.env` (next to the script) — see
[`config.env.example`](config.env.example). Key options:

- `MSG_LANG` — `en` or `tr` (logs **and** alert emails are bilingual).
- `ALERT_MAIL` — where alerts go.
- `THRESHOLD_24`, `THRESHOLD_24_PERMANENT`, `THRESHOLD_16`, `THRESHOLD_TEMP_24`,
  `THRESHOLD_TEMP_16` — tune sensitivity to your traffic.
- `LOOKUP`, `LOOKUP_TIMEOUT` — owner/hostname lookups for the emails.

Run once by hand to see it work: `./csf_autogroup.sh` (watch the log).

## Uninstall

```bash
crontab -l | grep -v 'csf_autogroup.sh' | crontab -
# WHM plugin (cPanel):
/usr/local/cpanel/bin/unregister_appconfig csf_autogroup
rm -rf /usr/local/cpanel/whostmgr/docroot/cgi/csf_autogroup /var/cpanel/csf_autogroup
rm -f /var/cpanel/apps/csf_autogroup.conf /usr/local/cpanel/whostmgr/docroot/addon_plugins/csf_autogroup.svg
# optional:
rm -f /var/log/csf_autogroup.log
rm -rf /var/lib/csf_autogroup
```
Existing `/24` bans stay in `csf.deny` until you remove them (`csf -dr <cidr>`).

## Languages

Logs and alert emails are available in **English** and **Turkish** — set
`MSG_LANG=en` or `MSG_LANG=tr`. The ban comments written into `csf.deny` follow
the same setting.

## License

MIT — see [LICENSE](LICENSE).
