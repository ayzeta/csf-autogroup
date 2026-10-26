# Changelog

## 1.15.30 — 2026-10-27

- **Fix: a failed rented-server list refresh waited a day.** The daily jobs
  were marked done for the day even when the list refresh that was due could
  not run, so the next try came the next day. Now the day stays open and the
  next run tries again.

## 1.15.29 — 2026-10-27

- **"Ignore" is renamed "Mute".** Hiding a *Needs review* row (and its
  emails) was called *Ignore*, the same word CSF uses for csf.ignore and
  IGNORE_ALLOW, so "Ignored" could mean either. The plugin's action is now
  *Mute* (*Muted* list, *Unmute*, History "Muted / Unmuted"); "ignored" in the
  panel, mails and log now only means CSF / lfd ignoring an address. Settings,
  files and existing mutes are unchanged.
- **Fix: the rented-server list refresh was marked done when it was skipped.**
  When the refresh could not run (no `ipset` in cron's path, before 1.15.28),
  it was still marked done for the day, so the lists were not downloaded and
  the next try waited another day. It is now marked only when it ran.

## 1.15.28 — 2026-10-27

- **Fix: cron runs skipped the firewall upkeep.** cron starts the plugin with
  `PATH=/usr/bin:/bin`, where `ipset` and `iptables` (in `/usr/sbin`) are not
  found, so runs from cron silently skipped refreshing and repairing the
  rented-server lists, the hit counter and the guard rules; only runs started
  from the panel or a shell did them. The plugin now adds `/usr/sbin` to its
  path.
- **Range card, simpler.** The result and every action (ban the range, the
  suggested narrower range, remove the range's own ban, ignore) are at the
  top. One table lists every IP in the range with its state now (permanent,
  temp with time left, not banned, closed by a block or range ban), service
  and reason; it replaces the services table, the single/temp list and the
  "not banned now" list, which repeated the same IPs. The note on bans older
  than the event log appears once.
- **IP card:** the *Needs review* entry comes right after the result, its
  *Ignore* button sits with the ban buttons, and the allow source is not
  repeated when the *Whitelist* section already shows it. Hostname is hidden
  while lookups are off.
- **Clickable looks clickable.** Addresses and ranges in every list are blue
  and underlined, text links are underlined, and the secondary buttons
  (*Ignore*, *Show more*, *Copy*…) have a border.
- **Nothing cut off:** addresses and ranges are never shortened (the
  *Ignored* list and the ban tables cut them before), and summary card titles,
  the *Why* column and service tile notes wrap. On phones card tables keep
  their headers and scroll sideways instead of turning into stacked rows.
- **Notifications:** the events table spans the card and says under each
  event when it is sent, instead of a paragraph above it. When Slack is not
  set up in WHM its column is dimmed. Mail and Slack intros are one sentence.
- **Shorter texts** across Settings, the *Needs review* and *Active range
  bans* intros, the remove and ignore dialogs, and the glossary.
- Smaller fixes: a filter chip equal to *All* is hidden; *Watched* shows just
  the days; History rows use ▸ / ▾ instead of + / −, don't repeat the row's
  own IP in the allow entry, and show provider-ban removals in grey; the
  Providers tab no longer lists the banned providers twice; settings history
  shows display names for retired settings and list sources; lfd's raw
  repeat-ban line is shown as "Repeat ban (PERMBLOCK)".

## 1.15.27 — 2026-10-26

- **Restored single bans count like any single ban.** In 1.15.26, after a
  block ban was removed by hand, only bans that came later counted towards the
  block's threshold, so restored singles were ignored. Now the choice in the
  remove dialog decides: restored singles count again (a block with 2 restored
  is banned when 1 more comes, at a threshold of 3), and unchecked ones are
  gone. When the singles to restore meet the threshold by themselves, the
  dialog says the block is banned again on the next run.

## 1.15.26 — 2026-10-26

- **Removing a block ban can restore the single bans it replaced.** When an
  automatic block ban is removed by hand, the confirm dialog offers to put
  back the single bans it rests on, with their reasons. The option is on by
  default and lists each IP. Before, those IPs were fully unblocked with the
  block, and lfd started counting them from zero. Restored singles go back to
  the permanent list with their original reason and a note. They do not get
  the block banned again: after a manual removal, only bans that come later
  count towards that block's threshold. IPs already banned, covered by another
  range ban, or in the allow list are not restored. The *Remove covered bans*
  action on the Providers tab offers the same option. Bans set before the
  event log say there is nothing to restore.
- **Shorter notes on allowed, ignored and server-IP rows** in *Needs review*.
  Each row now has one line for the source ("Ignored by: csf.rignore ·
  …"), one for the last record and one for the drop-off date. What to do
  about it moved to the status badge's tooltip.
- **Fix: the "Marked" column header was cut off** in *Needs review*. The
  column is wider.

## 1.15.25 — 2026-10-25

- **On the range card, click a service's IP count to see its IPs.** The
  count in *Violated services* opens the IPs of that service, with reasons,
  right under the row (an IP opens its IP card). The separate "IPs behind the
  ban" list from 1.15.24 is gone.
- **Repeat bans get their service.** When lfd makes an IP permanent
  (PERMBLOCK), its log line does not say which service was attacked. The
  plugin looked for the earlier temp bans in lfd's log, which may have
  rotated by then, and showed "service unknown". Every run now records the
  service of the temp bans it sees, so the service is known when the IP is
  made permanent later. The range card's service table resolves it the same
  way as its list of single bans: before, the table said "repeat ban" while
  the list named the service.
- **Look up a range.** *Look up an IP* also takes a range (`1.2.3.0/24`) and
  opens the range card; on phones the keyboard has "/".
- **The single-ban count of a block ban matches its IPs.** For bans written
  during the 1.15.12 incident, the count from the `csf.deny` comment ("4
  singles") is replaced by the number of distinct IPs in the record (2).

## 1.15.24 — 2026-10-25

- **What a ban rests on stays visible.** When the plugin replaces single bans
  with a block ban, or removes bans for another reason, the IPs and their
  reasons stay in the event log and on the cards.
  - The range card lists a block ban's IPs one by one, with service and
    reason, not only "4 IPs · Repeat ban". The same goes for a watched
    block's temp block ban.
  - A watched block's card says since when it is watched, how long is left
    and what makes it permanent.
  - Events behind a ban or a watch that is still in place are kept past the
    *History kept for* period.
  - Removing a ban (old block ban expired, *Remove*, or CSF's list limit)
    copies the IPs it rested on into the removal record, so the reason stays
    readable after the ban is gone.
  - A temp ban removed because a permanent ban already covers it keeps its
    reason in the record.
  - Bans and suspicious-network warnings record up to 256 IPs (was 40; the
    mail still lists the first 40).
- **No "no recorded violations" for bans the log never saw.** For a ban or
  watch set before the event log started, the cards say so and give the date
  the log started, instead of "No recorded violations from this range".
- **Fix: the same IP counted twice.** Events written during the 1.15.12
  incident list some IPs twice (a block shown as "4 IPs" had 2). The panel
  counts each IP once.

## 1.15.23 — 2026-10-25

- **Record keeping is set in days, not lines** (*Settings → Server → Record
  keeping*). History (bans, warnings, manual actions, setting changes) is kept
  for 180 days and run records for 31 days. Before, they were kept by count
  (5,000 events, 1,000 runs), so how far back they reached depended on the run
  frequency. At a 15-minute run the 1,000 runs covered about 10 days: the
  summary cards' comparison with 30 days ago and the weekly summary's run
  count came up short. Run records are kept for at least 31 days. The card
  shows how many records there are now and how far back they go. The file is
  rewritten at most once a day, not on every run.
- **Log fallback in days too.** Where logrotate is missing, log lines older
  than 30 days are removed (*Settings → Server → Log file*), instead of keeping
  the last 5,000 lines. `LOG_MAX_LINES` is replaced by `LOG_KEEP_DAYS`.
- **The run frequency setting explains the trade-off.** More frequent runs ban
  a block that crosses a threshold sooner (at most one run later). Every run,
  even a quiet one, adds a summary line to the log and a run record to
  History.

## 1.15.22 — 2026-10-24

- **Fix: review rows dropped off a day later than they said.** A row says it
  will drop off on its last record's date plus *Time on the list*. For
  allowed, ignored and server-IP rows (read from lfd's log) and for older
  suspicious-network and skipped rows (from the counter), the plugin kept the
  whole first day of the window, so the row stayed until the next midnight.
  Now it drops off at the time it shows.

## 1.15.21 — 2026-10-24

- **The range card tells the same story as the review list.** Its *Review*
  section used to say only "Flagged as … The top of this card says what to
  do." It now shows what the list row shows: how many IPs and on which
  services, how many blocks, permanent and temp, the narrower range
  suggestion, the repeat badge and the date it drops off the list. It also
  offers the row's ban buttons for the narrower block or range, and
  *Ignore*. Both use the same code, so they always agree.
- **The range card lists temp bans too.** The list of single bans inside a
  range left temp bans out, although the card counted them ("1 temp ban"). They
  are now listed, with the time left. IPs that are on the review row but not
  banned any more are listed under the review section; an IP shows up in only
  one of the two lists.
- **Fix: buttons inside the IP and range cards did nothing.** *Ignore* /
  *Stop ignoring* on the IP card (and now the range card's buttons) did not
  react to clicks, because the cards sit outside the area the click handler
  watched.
- **IPs in the cards' tables look clickable.** They open the IP card, but they
  looked like plain text and broke across two lines. They are now link-coloured
  like the review list's IPs, underline on hover, and stay on one line.

## 1.15.20 — 2026-10-23

- **Fix: two allow lines count as a pair only when they match the way CSF
  does.** A line that opens a port for incoming traffic (`tcp|in|d=22|s=IP`)
  needs an outgoing line with the same port as the *source* port
  (`tcp|out|s=22|d=IP`) to work while the address is banned. An outgoing line
  with the same port as the destination (`tcp|out|d=22|d=IP`) is not a pair,
  and with it the connection is still cut. The IP card used to say "opens only
  that port" for such a line too. Allow entries now show the port field as
  CSF writes it (`tcp in d=22`).
- **Columns line up.** The two columns under the summary cards now share the
  cards' columns: on *Providers* the left column takes two of the three cards'
  width and the right column one, and on the *Overview* the last summary card
  is as wide as the right column.
- **Fix: badges in the review list's status column were cut off.** The column
  is wider, and a badge that still does not fit (some English labels) wraps to
  a second line instead of being clipped.
- **Narrow layout fixes.** In a provider row on the *Providers* tab, the AS
  number no longer runs over the text next to it in a narrow card: the name
  moves to its own line. A card title's count stays next to the title. On a
  phone, the time in a *History* row comes right after the text instead of
  ending up alone on its own line.
- **Update banner:** when the version number has not changed (a change to
  tests or docs only), the banner shows the commit next to it
  (`v1.15.19 (318cba4) → v1.15.19 (13f33f2)`) instead of the same number twice.

## 1.15.19 — 2026-10-23

- **Fix: one-direction allow lines no longer count as "Ban not working".**
  A ban blocks incoming traffic, and outgoing traffic too unless
  `LF_BLOCKINONLY = "1"`. CSF accepts replies on established connections only
  after its ban check. So a CSF advanced allow line that opens one direction
  only (`tcp|in|d=…|s=IP`, or a `tcp|out|…` line on its own) lets nothing
  through while the address is banned: the replies are dropped. Before,
  `tcp|in|d=1:65535|s=IP` (and an advanced line without a port) counted as a
  full allow, so the address's bans were marked *Ban not working* and left out
  of the counts. Now it counts as a full allow only together with the line for
  the other direction (`tcp|out|s=1:65535|d=IP`), or against a ban that blocks
  incoming traffic only: a temp ban written `in` (lfd does this with
  `LF_SELECT` on), or a permanent ban with `LF_BLOCKINONLY = "1"`.
- **Advanced allow lines are read in CSF's field order.** The first `s=` / `d=`
  field after the direction is the port and the next one is the address. CSF
  rejects a line whose first field is an address (`tcp|in|s=IP`), so the
  plugin does not count it as an allow any more. That includes the
  rented-server list and the ban guard, which used to pass such an address on
  every port.
- **The IP card says what a single-direction allow line does under the current
  ban.** With an incoming-only line, if the ban blocks both directions, the
  card says the line opens nothing. With an outgoing line (such as the ones
  Imunify360 adds for its own servers), it says a ban on that address cuts the
  server's connections to it too. "Opens only that port" is shown only when
  that is true.

## 1.15.18 — 2026-10-23

- **Faster suspicious-network check in a run.** The number of different /24s
  in a /16 is now counted only for networks that reach the /16 threshold, and
  without starting extra programs. Before, it was counted for every /16 with
  a single in it (four programs each), which took most of a second per run
  when many networks had singles. The result is the same.

## 1.15.17 — 2026-10-23

- `AG_PROF` also times a run's suspicious-network section step by step, with
  how many /16 networks it looked at and how many reached the threshold.
  Without `AG_PROF` nothing changes.

## 1.15.16 — 2026-10-23

- `AG_PROF` also times the start of a run's block grouping (provider bans,
  repeat-ban services, and each step before the provider check). Without
  `AG_PROF` nothing changes.

## 1.15.15 — 2026-10-23

- **A run no longer starts `csf -t`.** The temp list is read from CSF's own
  file (`csf.tempban`) in the same form `csf -t` prints (one line per port of
  a multi-port ban, expired entries left out). `csf -t` took about a second
  per run on a busy server; reading the file takes a few milliseconds. Both
  gave the same list for single, port, multi-port, outgoing, two-way, range
  and IPv6 temp bans on CSF 16.33. `csf -t` is still used if the file can't be
  read.
- **Fix:** `AG_PROF` printed an error instead of part of its summary when a
  label contained an apostrophe.

## 1.15.14 — 2026-10-23

- **Faster status and runs, third round** (from timings taken inside each part
  on a real server; output unchanged):
  - advanced allow lines (`tcp|in|d=22|s=…`) are read in the same one pass as
    plain address lines instead of one at a time;
  - the rented-server lists are sorted once and kept until they change, and
    lookups in them use a binary search; the review list no longer looks up
    the same addresses in them twice;
  - the *Watched* blocks and the Imunify360 ranking are built in one pass.
- **Fix — HTTP 500 on the first page load after an update.** While cPanel's
  service reloads its configuration, WHM's page header cache can be missing for
  a few seconds and cPanel's own header code throws ("User does not exist in
  cache_keys"). The page now waits briefly and tries the header once more;
  if it still fails, the plugin opens without the WHM frame instead of an error
  page (the frame is back on the next load).

## 1.15.13 — 2026-10-23

- **Fix — a diagnostic status run could turn into a real run.** In 1.15.12,
  `AG_PROF=1 … --status` read `/proc/uptime` with the status output's field
  separator and hit a shell arithmetic error. Bash then left the whole mode
  switch instead of only the function, skipped its `exit`, and went on with a
  normal run. That run read `csf.deny` a second time on top of the first, so
  every single ban counted twice and blocks with two banned addresses reached
  a threshold of three. Normal runs and the panel were not affected (the
  timing code only runs with `AG_PROF`). Now:
  - the timer reads `/proc/uptime` independently of the field separator and
    skips a value it cannot read instead of failing;
  - a mode that stops on an unexpected error exits instead of falling through
    to a run;
  - reading `csf.deny` a second time in one process starts over instead of
    adding to the first read, so an address is never counted twice.
  If you ran `AG_PROF=1 … --status --json` on 1.15.12 and got a block-ban
  email listing each address twice, those bans came from this; remove them
  (with *restore the removed entries*) from *Active range bans*.

## 1.15.12 — 2026-10-23

- **Finer timing for diagnosis.** With `AG_PROF=1` the status and a run
  (also `csf-autogroup dry-run`) now print where the time goes inside each
  part: each allow file read and loaded separately, the review list step by
  step, the provider rankings, the owner cache, and each section of a run,
  with counts (lines, rows, entries). Without `AG_PROF` nothing changes.
  Timing inside loops no longer starts a process per mark: it uses bash's
  `EPOCHREALTIME` where available, otherwise `/proc/uptime`.
- **A run reads CSF's temp list once.** `csf -t` (about a second on a busy
  server) ran twice per run; the second read reuses the first.
- The *Active range bans* rows are built without a subshell per row.

## 1.15.11 — 2026-10-23

- **Faster status, second round** (from a real server's `AG_PROF` profile):
  the *Ban not working* rows matched every ban in the lfd log against every
  allow-list range one by one, now ranges are grouped by network; Imunify360's
  allow list (search-engine bots) is read in one pass; the review list
  filters the event log before reversing it instead of reversing all of it;
  and the threshold preview's per-block loop runs in one pass. Output is
  unchanged.

## 1.15.10 — 2026-10-23

- **Faster status with large allow lists.** With allowed services on, the
  allow list has thousands of ranges. 1.15.7's check for bans on allowed
  addresses compared every ban with every range one by one and judged each
  entry separately, which made every page refresh several seconds slower.
  Ranges are now grouped by network, the allow list's plain address lines
  are read in one pass, and the status is faster than before 1.15.7.
- **Faster status overall.** `csf.deny`, the allow lists and the owner cache
  are each read in one pass instead of line by line; the ignore list is read
  once per request instead of once per block checked; the review list looks
  only at the event kinds it shows; the open-service check builds the list of
  single bans once instead of once per partial ban; and the rented-server
  figures in the Providers tab are recalculated only when their inputs
  change. On a test set of 3,000 single bans, 4,300 allowed-service ranges,
  3,000 owner entries and a week of events the status went from about 11 s
  to about 4 s. `AG_PROF=1` now breaks down the slowest parts further.

## 1.15.9 — 2026-10-23

- **Fix — old numbers after coming back to the tab.** Browsers put a hidden
  tab to sleep, so on return the page still held data from when it was left.
  *Last run* then showed that data's age ("1 hour ago") until the new status
  arrived and said "14 min ago". When the data is more than a minute old,
  *Last run*, *Run time* and *Next* now show "updating…" until the new status
  arrives, and actions wait for it.

## 1.15.8 — 2026-10-22

- **Short command: `csf-autogroup`.** The installer adds
  `/usr/sbin/csf-autogroup` with `update`, `check` (only says whether an
  update is available), `reinstall`, `run`, `dry-run`, `status`,
  `lookup IP`, `log` and `version`; `sudo csf-autogroup update` replaces
  `cd csf-autogroup; sudo bash update.sh`. Existing installs get it with this
  update (the panel's **Update** button or `bash update.sh` one last time).
  `update.sh --check` is new too.
- **Fix — IP card picked the wrong allow line.** With both a single-port and
  an all-ports allow line for the same address, the card showed the first one
  and said a ban on the address works; it now prefers the all-ports line
  (the ban does not work).
- **Fix:** the mail accounts on a *Server's IP* review row now use the same
  window as the IP card (each line's own date), so both show the same
  accounts and counts.
- **A ban that does not work always gets its row.** *Ban not working* rows
  came only from the lfd log, so an address allowed after it was banned, or
  whose lfd log line had rotated away, was shown correctly only on its IP
  card. Bans in CSF on fully allowed addresses now get the row too (once per
  address; the count comes from lfd when it has a line). A ban line without a
  date opens no row.
- **Faster panel on busy servers.** The attempts cache is no longer read
  whole on every refresh, only the lines of the addresses on screen (a server
  hit by SSH brute force can have tens of thousands of addresses in it). The
  cache is rebuilt by the run; the panel and the IP card rebuild it in the
  background only when it is missing or more than two hours old, so a page
  never waits for a log scan. Only one rebuild runs at a time.

## 1.15.7 — 2026-10-22

- **Fix — an allowed address's ban was counted.** lfd writes temp bans for
  addresses in `csf.allow` too (`csf -td` does not check allows), and a
  permanent ban can stay after an address is allowed. These bans do not work,
  but they counted toward the suspicious-network and block thresholds (four
  real bans plus one allowed address raised a network warning), the
  threshold preview in Settings and the IP card's distance to the threshold.
  A ban on an address allowed on all ports is no longer counted anywhere; the
  address keeps its own *Ban not working* row. A range that is allowed as a
  whole (an allowed service) therefore no longer shows as a whitelist-skipped
  block.

## 1.15.6 — 2026-10-20

- **What an address tried, for every service.** Next to the mail accounts,
  the IP lists, the IP card (*Attempts*, also `--lookup`) and email / Slack
  lines now show the SSH users, FTP accounts, cPanel / WHM / Webmail logins
  (an API-token attempt is marked separately from a wrong password) and web
  password users an address tried, and the sites and addresses ModSecurity
  blocked for it. A web ban whose reason names a ModSecurity rule shows only
  that rule's targets. Only lines lfd itself counts are read (its own
  patterns; ModSecurity *Warning* lines such as 404 tracking are not), from
  `SSHD_LOG`, `FTPD_LOG`, `CPANEL_LOG`, `HTACCESS_LOG`, `MODSEC_LOG` and the
  mail logs, with rotated copies including cPanel's log archive.
- **Only the review window counts.** Each line's own date decides, so a log
  that is rarely rotated (cPanel rotates its logs by size) no longer brings
  back attempts from years ago.
- **Counts match lfd.** A dovecot failure line counts as one attempt, as lfd
  counts it, so the numbers add up to the count in the ban reason.
- **Fix:** on a narrow screen the *repeating* tag of a suspicious network hid
  the network address in *Needs review*; the tag now starts the row's note
  line, so the first line of every row stays aligned.

## 1.15.5 — 2026-10-20

- **Mail accounts tried, for every address.** The accounts an address tried
  to log in to with a wrong password (SMTP, IMAP, POP3; from `SMTPAUTH_LOG`,
  `POP3D_LOG`, `IMAPD_LOG` and their rotated copies in the review window) were
  shown only for the server's own IP. They now show for any address: in the
  IP lists of review rows, ban groups and History, on the IP card (also
  `--lookup` in the terminal), and in email and Slack lines next to the ban
  reason. The logs are read in one pass for all addresses and the result is
  kept for 10 minutes.
- **Why lfd made an address permanent.** An lfd repeat ban showed only
  `(PERMBLOCK)`: the rest of lfd's line was cut off with the address. It now
  reads e.g. "Repeat ban (PERMBLOCK): in the last 24 hours, at least 4 temp
  bans, made permanent" (from `LF_PERMBLOCK_COUNT` and
  `LF_PERMBLOCK_INTERVAL`), with the service of the earlier temp ban when
  lfd's log still has it. Records from before this version explain what
  PERMBLOCK means.

## 1.15.4 — 2026-10-17

- **Fix — an ignored address was still reported.** *Needs review* hid an
  ignored allowed / ignored / server-IP row, but the run still wrote its daily
  History record and sent it by email (and Slack). The same held for a block
  skipped because of an allow entry when that block was ignored. Now nothing
  is recorded or sent for what you ignored — also for an address inside an
  ignored range, the same rule as the panel. The IP card finds the ignore
  that covers the address whatever its size (before: only the address, its
  /24 and its /16).
- **Allow entries carry their comment everywhere.** The comment you wrote on
  an allow line (`1.2.3.4 # office`) showed on the review rows and the IP card,
  but not in the email, the History record, the skipped-block email, the ban
  window and the suspicious-network row. All of them now show the entry the
  same way: `csf.allow: 1.2.3.4 (office)`.
- **Email and Slack say what the panel row says.** An allowed-IP violation is
  listed with its hostname and owner, the service (by the panel's name, e.g.
  *Mail sync* instead of `sync`), how many times, the state, the allow or
  ignore entry with its comment, lfd's last record with its time and, for the
  server's own IP, the mail accounts that were tried. An open service names
  the range, the closed services, the violations per open service and the
  owner.
- **Who ignored, and when.** *Ignored* and the IP card show "root ignored it,
  2 days ago" (full date in the tooltip). Entries made before this version get
  the time from the History record of the ignore. Changing the duration keeps
  the original time.
- **New event kind: allowed-IP violations and open services.** These daily
  review records were part of *Run notices* and could not be turned off on
  their own. They have their own row in *Events and channels*
  (`IE_REVIEW`, `IC_REVIEW`; on by default, as before).
- Slack: collected notices are sent whenever any kind in the queue is turned
  on for Slack (before, only when *Run notices* was on).
- **When a review row drops out.** Every *Needs review* row now says when it
  leaves the list by itself if nothing new comes: "Drops off the list by
  itself on Oct 23 if no new attempt comes" — counted from the last attempt
  (allowed / ignored / server-IP rows), the last warning (suspicious
  networks, skips) or the last violation of the open services (open
  services). The IP card says the same, and the glossary explains it. So you
  can wait and watch instead of ignoring a row.
- **Open services follow the same window.** An open-service row counted every
  single ban placed after the partial ban, however old; singles stay in
  `csf.deny` for long, so the row could stay for good. It now counts only
  those from the last *Days kept in the list* days and drops out when the open
  services see no new violation for that long; the daily notice uses the same
  window. *Active range bans* and the unban window still show every violation
  since the partial ban.
- The help of *Days kept in the list* named only suspicious networks
  and skipped blocks; it now says it applies to every *Needs review* row and
  counts from the row's last record.

## 1.15.3 — 2026-10-16

- **Fix — "Your session has expired" on a page left open for long.** Each
  panel request carries a security token that is valid for 12 hours. After
  that the panel said the session had expired and stopped refreshing, so the
  run card and everything else stayed old, even though the WHM session was
  still open. Now an expired but genuine token is replaced automatically and
  the request is repeated once; the notice remains only when the WHM session
  itself has ended (WHM answers with its login page).

- **New-since-last-visit dot on review rows with a new record.** Since 1.15.2
  the *Flagged* time of an allowed, ignored or own-IP row is its first record,
  so a row that got a new record today (counted in the "since your last
  visit" bar, and the row **Show** jumps to) had no "new" mark once the brief
  highlight faded. The dot now also appears when a new record arrived for the
  row's address or range since your last visit; its tooltip gives the time and
  says that *Flagged* shows the first record.

## 1.15.2 — 2026-10-15

- **Allowed, ignored and own-IP rows: first and last record.** In *Needs
  review* the *Flagged* column of these rows now shows the first record in
  the review window (it showed the last one, while the "Last entry" note had
  no time at all); the note reads "Last entry: … (1 day ago)". The IP card
  shows the same in short lines: last entry with its time and the count,
  then the mail accounts for the server's own IP, or the allow / ignore
  source for the others; the "cannot be banned" sentence is no longer
  repeated under the card's firewall result.

## 1.15.1 — 2026-10-15

- **Run card keeps up:** the page asks for a fresh status 3 seconds after
  the cron minute and every 5 seconds until the run's record arrives (it
  waited for the regular 60-second poll before); a tab shown again after
  being hidden, or a page restored from the browser's back/forward cache,
  refreshes right away when its data is older than 30 seconds, with an
  "updating…" note under *Last run* meanwhile. The *Last run* tip shows when
  the status data was fetched, so a stale number can be told apart from a
  stale page.

## 1.15.0 — 2026-10-14

- **Notifications: one table for events and channels.** Settings →
  Notifications now starts with an *Events and channels* table: four kinds
  of event (firewall problem, list filling up, run notices, weekly summary)
  × email and Slack, each cell on or off. Email gets the same per-event
  choice Slack already had (`IE_FIREWALL`, `IE_LISTFULL`, `IE_RUN`,
  `IE_DIGEST` in `config.env`). The old `NOTIFY` and `DIGEST` keys keep
  working and are shown through the table (`NOTIFY=email` reads as the Slack
  column off, `DIGEST=0` as the summary row off); touching the table writes
  the per-event keys. The email and Slack cards are shown only while at
  least one event goes to that channel; the weekly summary card keeps the
  day.
- **Review records in the mail and the summary:** the run mail has sections
  for the day's new review records — violations from allowed, ignored or the
  server's own IPs (service, count, why the ban did not apply, where the
  allowance comes from) and open services behind a partial ban; the weekly
  summary counts both for the week.
- **Fix:** the "since your last visit" bar counted the daily review records
  (and block bans removed outside the plugin) as suspicious networks; each
  kind is named on its own now.
- **Fix:** Settings opened on the Notifications section; it opens on the
  first section (General) now.
- Tests: the state table checks that a run with run notices off by email
  sends no mail and that the list-filling warning still goes on its own;
  the browser test covers the table (eight cells, one click is one unsaved
  change, fits a phone screen).

## 1.14.5 — 2026-10-14

- **History rows line up:** rows without a ⋯ menu (provider-ban changes,
  removed temp bans, grouped rows) drew their time further right than the
  rest, and the expand mark (+) that only rows with an IP list carry pushed
  the date digits of those rows left. Every row now keeps the menu column
  and the mark's slot, empty where there is nothing to show. The browser
  test checks that the time column and the date digits each have one right
  edge.
- **Fix:** the "ignored (until …)" state note on History rows showed the raw
  date (2027-01-03); it uses the panel's date format now.

## 1.14.4 — 2026-10-14

- **Settings sections open the same way:** every section starts with its
  one-line explanation, then the cards. Two sections had the line and four
  did not, so the content jumped while switching sections. The browser test
  checks that the first card sits at the same height in every section.
- **Notifications cards by kind:** Channels (which are on) → Email (address,
  test mail) → Slack (what goes there, test) → Weekly summary. Email and
  Slack are both channels and were split by the summary card; the test-mail
  button sat away from the address.
- **Overview:** the Ignored card moved above Most blocked providers in the
  right column; it is part of the review list, not of the provider summary.

## 1.14.3 — 2026-10-14

- **Settings in order of weight.** The section list opened with
  Notifications while the switch that pauses the plugin and the run interval
  sat further down under Running. The first section is now **General**
  (running / paused, run frequency, language); then Ban rules (which also
  took the review-list period: it is an outcome of the rules), Notifications,
  Sources and refresh, Server (which took the log file: a server matter),
  Settings history. Running and Records are gone as sections.
- **Overview on a phone:** the 30-day chart came before Needs review, so the
  rows that need a decision started a screen down. On a phone the chart now
  comes after the lists; on a wide screen nothing moves.

## 1.14.2 — 2026-10-14

- **History keeps the review list's findings.** Rows for violations from
  allowed, ignored or server-own addresses and for open services (a partial
  ban whose open services keep taking violations) were recomputed from the
  logs on every run and vanished after the review period; nothing was
  recorded. Each run now writes them to History once a day: *Violation from
  allowed IP* (kind, service, count in the last 24 hours, the allow entry,
  lfd's last reason) per address, *Open service* (closed services, count
  since the ban) per range. History has filters for both; the IP card shows
  them. A dry run writes nothing.
- **IP card:** the Needs review line now carries the same data as the table
  row (the mail accounts tried from the server's own address, lfd's last
  reason, the count in the review period); it gave only the short sentence.

## 1.14.1 — 2026-10-14

- **Settings: one card per group.** Each section stacked its groups in a
  single card under small uppercase headings while the Server section used
  separate cards. Every group is its own card now (Block ban, Suspicious
  network, Watching, Old bans; Runs, Needs review, Log file; Owner lookups,
  Rented-server lists, Allowed-service lists, CSF's ASN data, Imunify360;
  Channels and language, Weekly summary, Sent to Slack), with the section's
  one-line explanation above the cards. Labels that repeated their card's
  title were renamed (the log status row, the review-list days field, the
  weekly-summary and Slack fields).

## 1.14.0 — 2026-10-14

- **Wording: "attack / attacker" is now "violation / offending IP"** across
  the panel, the glossary, the mails and the weekly digest, and this README.
  lfd bans an address for repeated failed logins, a ModSecurity match or a
  port scan; a customer who forgot a password or a misconfigured mail client
  trips the same rules, so "attack" overstated what the plugin knows. The
  review list's "allowed attacker" is "violation from allowed IP". The
  glossary explains the term. "Suspicious network" stays.
  The text test refuses the old words in user-facing texts from now on.

## 1.13.20 — 2026-10-14

- **Impact window: examples of refused requests from allowed services.**
  "Responses allowed services got" showed counts only (say, 27 refused with
  403); now it lists the most frequent refused requests under the counts:
  code · site · request ×N, the service and an example IP. A 403 given to
  Googlebot is the site or ModSecurity refusing the page, not a ban; the
  list shows which page. On a phone the example lines wrap instead of being
  cut (the open-address examples too).
- **Ignored card:** one line per row again (range · end date · who · ⋯),
  lined up with the column headings; the two-line row did not match its
  headings and sat on the card's bottom edge. In a narrow column the ⋯ button
  was drawn under the text.
- **Rank numbers only where there is a ranking:** Banned providers listed
  its rows as 1, 2, 3 like Most blocked providers; it is a list, not a
  ranking, so the numbers are gone.
- Browser test: consistency rules on every tab at both widths — a table's
  headings match its row cells, rank numbers appear only in the ranking card,
  no row cell overlaps another, the last row does not touch the card's edge.

## 1.13.19 — 2026-10-14

- **Records merged into Running:** the review period and the log file settings
  were a section of their own next to Running (pause, run frequency); they
  are groups of the Running section now. Settings has six sections.
- **Fix:** the "restart watch" window pointed to "Settings → Records" for the
  watch period, which lives under Ban rules → Watching.

## 1.13.18 — 2026-10-14

Settings, from a desktop screenshot:

- **Number fields** have − / + buttons and are narrow (they were 120 px wide
  text boxes relying on the browser's tiny spin arrows). The buttons step
  within the field's limits and run the same validation as typing.
- **Right column aligned:** the Weekly digest rows (on/off and the day) were
  left-aligned inside the column while every other control sat at the right
  edge; they align right now (left on a phone, like the rest).
- **Old bans moved into Ban rules** as a group of its own: three settings did
  not need a section. Texts that pointed to "Settings → Old bans" now say
  "Settings → Ban rules → Old bans".
- **Fix: windows (Glossary, confirmations) ran past the screen on a phone**,
  hiding the title and the Close button: the height limit was tied to the
  viewport unit, which on phones is the largest viewport with the browser
  bars hidden. The window now fits the visible area; its body scrolls.

## 1.13.17 — 2026-10-14

- **History rows on a phone, tighter:** 1.13.16 moved the time to its own
  line under the details, which made every row five lines. The time (with
  the expand mark) now ends the details text, and the owner joins that text
  instead of taking a line: a typical row is two or three lines. On a wide
  screen the time stays at the right of the first line.

## 1.13.16 — 2026-10-14

Phone layout, from screenshots of the panel inside WHM:

- **Header:** the three buttons (Glossary, Dry run, Run now) stacked on the
  right and made the header twice as tall as the title; they now sit in one
  full-width row under the title (a fourth button, Run log, wraps below).
- **History rows:** the time, the expand mark and the ⋯ menu crowded the
  right of the first line while the badge dropped alone to the next; now the
  first line is the address and its badge with ⋯ at the right, the details
  follow, and the time with the expand mark closes the row. The filter chips
  are smaller so they fit in two rows.
- **Providers → "Ban…":** the page scrolled to the top of the provider-ban
  card, which left the measurement window off screen; it now scrolls to that
  provider's row, with the window right under it, and keeps WHM's sticky
  header clear in whichever container the page scrolls.

## 1.13.15 — 2026-10-13

- **Ignore from the IP card.** The card's Needs review line offers Ignore for
  the row the address belongs to (and Stop ignoring when it is ignored).
- **Change an ignore's duration** from the Ignored card's menu (7/30/90 days
  or indefinitely) without stopping and re-adding it.
- **Restart the watch** of a watched block from its menu and from the IP
  card: the watch period starts again from today (event *Watch restarted*).
- **Fix: the server's-own-IP row listed accounts from today's mail log only.**
  Attempts from a few days ago sit in the rotated `exim_mainlog-YYYYMMDD.gz`
  / `maillog-*`; the plugin now reads the rotated files inside the review
  window too (the row names the base file, not each rotation).
- **Fix: a temporary block ban could be reported as failed although CSF
  placed it.** The check took any "failed" in csf's output as a refusal; a
  Perl locale warning ("Setting locale failed") on the server triggered it.
  The plugin now looks for the ban in CSF's temporary list first and only
  treats csf's own "failed:" / "deny failed:" lines as refusals.
- **Panel polish from the screen review:** the Ignored card's actions sit in
  the row's ⋯ menu (two buttons did not fit the narrow column); the event
  list shows ignore end dates in the panel's date format; on a phone a row
  whose owner is unknown no longer shows a lone "—"; the Settings-only
  wrapping of option rows no longer stacks the chart's 7/30-day switch.
- **Phone layout (390 px), card by card:** the Ignored row fell under the
  general row layout, which left its ⋯ button mid-row; it keeps its own
  two-line layout now. In Watched, the remaining-days bar spans the row when
  the owner is unknown instead of leaving the left half empty. In Most
  blocked providers, the "Ban…" button drops under the text instead of
  squeezing it.
- **Change duration opens its own window:** titled for the change, showing
  the current end date, with a "Change duration" button (it opened the
  "ignore?" window). The IP card's Needs review line no longer repeats the
  address when the row is the address itself.
- **Settings wording:** Ban rules fields are *Permanent ban threshold*, *Temp
  ban threshold* and *Suspicious network threshold* (the group heading
  already says /24 or /16; the label repeated it). The Old bans help named
  the card by its old name "Active block bans".
- Browser test: IP-card ignore, change duration, restart watch, menu
  visibility; status-table cases for restart watch and rotated mail logs.

## 1.13.14 — 2026-10-13

Eight small panel items from the review list of 1.13.11, closed together:

- **Glossary:** entries for ModSecurity, Imunify360, run, dry run, reverse
  DNS / forward check, Team Cymru, AbuseIPDB, *repeating* and the new *range
  ban*; the text test now requires the *repeating* badge to be covered.
- **Range card:** when a wider ban covers the range, "whole range banned"
  was said three times (verdict, layer list, question); now only the verdict
  says it. A service counts as closed by a rented-server list or a provider
  port list only when its UDP side is closed too (web needs UDP 443, HTTP/3).
- **Ban window:** cPanel ports are written as the real list (2077–2080, 2082,
  2083, 2086, 2087, 2095, 2096) instead of "2077–2096", which is not what CSF
  opens; when the range is already inside a wider ban the note says what to
  do (no new ban needed; remove the covering ban to ban it on its own).
- **Most blocked providers:** the bar explains itself (ranking weight, the
  lighter part = ranges added by hand or another tool; on the other tabs the
  count shown) and the provider-ban suggestion says when it appears (5+
  block bans, not already banned).
- **Measure impact:** "web logs not found" names the directories looked at
  and the `DOMLOGS` setting for another location; a long measurement can be
  cancelled (the wait closes, a late answer is ignored).
- **"Active block bans" is now "Active range bans"** on the KPI and the card:
  it counts /16 network bans, announced-range and partial bans as well, which
  the old name hid. Glossary entry *Range ban*.
- **Settings:** the dots in the section menu have tooltips (unsaved change /
  newer version / missing tool / field error) and the Save bar names the
  section that holds an error, since Save is disabled until it is fixed.
- **Dry run:** the window opens with a summary — what the run would do (ban,
  unban), notifications that would go out, problems, the per-round lines —
  and the raw engine output under "Raw output".

Also in this version:

- **Ignore indefinitely.** The Ignore window offers "Indefinitely" next to 7,
  30 and 90 days; such an entry stays until you stop it (the Ignored card
  shows "no end date"; the IP card and the event say "indefinitely").
- **Fix: "Stop ignoring" was invisible.** The Ignored card sits in the narrow
  column of the Overview, and its four-column row pushed the button past the
  card's edge, where it was clipped. The row is now two lines (range · Stop
  ignoring / end date · who), and the browser test checks that the button is
  inside the card. The IP card of an ignored address also offers Stop
  ignoring.
- Mails and the weekly summary use the new "Active range bans" name too.

## 1.13.13 — 2026-10-13

- **Fix: the IP card failed with "abKind is not defined"** for an address in
  the review list (1.13.12: the helper that names the review state was
  defined inside the review list's code, out of the IP card's reach). The
  card and the Needs review rows now share one top-level helper.
- **Fix: Ignore was missing for some review rows.** The rows for allowed or
  ignored attackers, allowed ranges and open services had only "IP card" in
  their menu, although the card's text says every row can be ignored. They
  now have Ignore like the other rows, and the engine accepts a single IP or
  any /8–/31 range as the ignore target (it took only /16 and /24).
- **IP card for the server's own address** says so in the verdict ("lfd
  always ignores its own addresses; the plugin never bans a range that
  contains its own IP") and shows no ban buttons; it used to read like an
  allow-list entry with ban buttons that the engine would refuse.
- **The *Server's IP* badge fits the state column** (it was cut off as
  "Sunucunun ker…"); the glossary entry is "Server's IP (its own address)".
- **Fix: option rows in Settings ran past the card on a phone** (390 px, e.g.
  Notification channels); they wrap now.
- **New: browser test of the panel** (`tests/arayuz/`): the real pages in
  PHP's built-in server driven by a headless Chromium — every tab at desktop
  and phone width (no overflow, no clipped badge), the glossary, the IP card
  and menu of every review row, and the Ignore / Stop ignoring flow end to
  end, so a scoping slip like the IP card error above is caught before a
  release. The real-CSF container setup now gives lfd a temporary SSH ban
  (`LF_SSHD_PERM = "3600"`: a value of 0 is not "temporary" in CSF) and, where
  the container's DNS answers no Team Cymru query, a `dig` wrapper that
  answers for the test network.

## 1.13.12 — 2026-10-13

- **Needs review: the server's own IP.** lfd never bans the server's own
  addresses (its `ignoreip` check; measured on CSF 16.33), so failed logins
  coming from the server itself were listed as *Ignored* with an unknown source
  and a ban hint. They now have their own state, *Server's IP*: no ban
  button, and when the mail logs (`SMTPAUTH_LOG`, `POP3D_LOG`, `IMAPD_LOG`;
  exim and dovecot formats) show which accounts tried wrong passwords from
  inside the server, the row lists them with attempt counts, so the site or
  script behind them can be found.
- **Needs review: no more "unknown" ignore source.** For an ignored address
  that is in none of the allow or ignore files, the plugin now looks where lfd
  looks, in lfd's order: `CC_IGNORE` (country or ASN, from the owner cache),
  `RELAYHOSTS`, and `csf.rignore` through lfd's own reverse-DNS cache
  (`csf.dnscache`) or one lookup. The row names the source; when nothing
  matches it says which lists were checked.
- **Needs review: your `csf.allow` comments.** The comment on an allow line
  (`1.2.3.4 # office`) is shown next to the source in the review list, the IP
  list and the IP card, so you can tell why an address is allowed.
- **Fix: a successful SSH login is not an attack.** lfd's `*SSH login*` alert
  for an allowed address ends in "- ignored" too; it was counted as an ignored
  attacker.
- **Fix: an allow line that opens every port** (`tcp|in|d=1:65535`) counts as
  a full allow (*Ban not working*), not as a single-port one.
- **Banned providers have their own card.** The *Banned* tab of *Most blocked
  providers* was a state list among rankings and did not fit on one line; it is
  now the *Banned providers* card below it, on the Overview and the Providers
  tab.
- **Real-CSF tests in a disposable container.** `tests/senaryo/kur-bulut.sh`
  installs cPanel's CSF (from GitHub or a given `cpanel-csf` RPM / archive) with
  the cPanel-only Perl modules stubbed, starts lfd and lets it extract the
  provider and country zone files the scenarios need (lfd only does that on
  start, for what `CC_DENY` names), so `GERCEK=1 bash tests/senaryo/calistir.sh`
  runs there. The scenario test restarts lfd without systemd, keeps the
  session's proxy out of the test client and binds its test web servers to
  IPv4 (a network namespace without IPv6 refused the default dual-stack
  bind). Measured on the way: with `LF_SSHD_PERM = "1"` lfd asks `csf -d` for
  the ban and CSF refuses an address that is in `csf.allow` ("deny failed: …
  is in the allow file"), so no ban is placed at all; the test VM uses
  temporary bans. New status-table cases for every item above.

## 1.13.11 — 2026-10-13

- **New: sites behind a CDN.** When a site's domain or its www name points to
  a CDN (QUIC.cloud, Cloudflare, Sucuri, CloudFront, Fastly, Akamai) or another
  address instead of this server, its visitors reach the firewall through the
  CDN and a CSF ban can not cut them. `tools/cdn-sites.sh` finds these sites
  once a day by DNS (and the CDN by its response headers). Measure impact shows
  their requests in their own bucket ("a ban does not affect them", with where
  to block them: the CDN's panel), and `tools/ban-leak.sh` no longer counts them
  as leaks but lists them separately. Measured with real DNS and HTTP replies.
- Measure impact: the "bans on this provider" list used the monospace font of
  the request lists; it reads as normal text.
- **Glossary covers every state the panel shows,** in sections (bans,
  providers and lists, allows and ignores, review list, tools): the new review
  states, the allow list vs ignore difference and CSF's `IGNORE_ALLOW`
  setting, announced range, full/partial, came back, manual, old, provider
  (ASN), CSF and lfd. The badges' tooltips say the same and name the CSF
  setting behind them. The text test now fails if a state badge has no
  glossary entry.
- **New: allowed but attacking.** lfd can not stop an address that is allowed
  or ignored. Measured with real lfd (CSF 16.33):
  - With `IGNORE_ALLOW = "0"` (CSF's default) lfd still bans an address that is
    in `csf.allow` (also a range), but the ban does not work and the alert says
    "block may not work".
  - With `IGNORE_ALLOW = "1"`, and for `csf.ignore` / `csf.rignore`, lfd does not
    ban and writes "… - ignored" for every attempt.

  The review list now reads these lines from the lfd logs of the last 7 days,
  rotated and compressed ones included, so a temp ban that already expired is
  still seen. Each attacker shows once, in the widest group that applies:
  - several addresses inside one allow entry: one "Allowed range" row;
  - a block where allowed and banned attackers together reach the block
    threshold: the usual "Skipped" row;
  - a network that meets the suspicious-range rule: the usual "Suspicious" row;
  - otherwise one row per address: "Ban not working" (full allow) or "Ignored"
    (`csf.ignore`/`csf.rignore`: CSF also refuses to ban the address on its
    own, but a ban on the block containing it cuts it — measured).

  A row from an allowed service offers "Exclude from allowed services"; for
  your own `csf.allow` / `csf.ignore` entries it says which file to edit. The IP
  card and the range card show the same information.
- **New: open service.** When attacks on the services a partial ban
  leaves open reach the block (or network) threshold after the ban went in,
  the range shows in the review list as "Open service" with "Change ban".
- The review list and the IP card name an allow entry the same short way
  ("allowed service openai-gptbot (…)"); the full path is in the tooltip.
- `tools/ban-leak.sh` counts rented-server list requests only from the moment
  the rule is in place (written by `tools/cloud-ban.sh`); requests from before
  are the old state, not a leak.
- The service of lfd's "ignored" lines (they carry no "(sshd)" prefix) is
  recognised (SSH, POP3/IMAP, SMTP AUTH, FTP).
- **Fix — false "Runs are not on schedule" for a few seconds.** Returning to a
  panel tab left open in the background redrew it with the old data first, and
  the last run time compared to the current clock looked hours late until the
  refresh arrived. The overdue check now waits for fresh data.
- **Faster status:** `csf.conf` is read once per call instead of on every
  lookup, the SSH port (`sshd -T`) is looked up once, and rented-server list
  membership is checked for all addresses in one pass instead of re-reading
  every list per address.
- **IP card says each thing once.** For an allowed address the allow list was
  repeated four times (result, under the ban buttons, block state, whitelist)
  and the card did not fit the screen. The result names the list briefly
  ("allowed service openai-gptbot (…)"), the full path stays under Whitelist,
  the block state is one sentence. A "not blocked" badge no longer repeats the
  "not banned" result.
- **Range card knows the range's own ban:** kind, date, kept, how many singles
  it was put on and the attacks behind it (from the event log), so a banned
  block no longer reads "no bans in this range"; its old watch record is not
  listed as a watched block.
- **Tests:** the state table covers the allowed-but-attacking cases (ban not
  working, ignored with `IGNORE_ALLOW`, `csf.ignore`, not allowed, single-port
  allow, allow-range group, mixed block, older than 7 days, rotated `.gz` log,
  open service); the real-CSF scenarios send failed SSH logins from an allowed
  client to real lfd with `IGNORE_ALLOW` 0 and 1 and with `csf.ignore`; the
  speed test includes 20 old warnings and 200 allowed-attacker lines.
- **Tests:** real-CSF scenario for "exclude from allowed services": an allowed,
  banned IP gets through; after the exclusion is saved and applied its ban
  works, the rest of the list stays allowed, and removing the exclusion
  restores it.
- **Fix — automatic block ban no longer erases lfd's repeat history.** The
  singles inside a new /24 were removed with `csf -dr`, which also deletes the
  address from lfd's temp-ban history (`csf.tempip`, measured): an attacker that
  came back was counted as new by lfd. They are now removed from `csf.deny`
  directly; the /24 already covers them.
- **Fix — a full range ban no longer ends watching for good.** Banning a range
  removed the watch records of the blocks inside it and lifting the ban did not
  bring them back, so a block that attacked again was not seen as "came back".
  The records are kept with the ban's restore copy and return when the ban is
  lifted (or removed from the CSF screen) while the watch period is still
  running. With "keep covered entries" watching is not interrupted.
- **New: block bans dropped by CSF's list limit are noticed.** When the
  permanent list reaches `DENY_IP_LIMIT`, CSF deletes the oldest lines not
  marked "do not delete" on every new ban — the plugin's block bans included,
  while the singles inside them are already gone (read from CSF's source,
  tested with real CSF). Each run now compares the plugin's block bans with the
  previous run: a block that left `csf.deny` without the plugin (and is not
  covered by a wider ban) is watched and reported by email and in History
  ("Removed by CSF limit, watched"), with the advice to raise `DENY_IP_LIMIT`.
  A watched block that reaches the threshold again — through temp bans or
  permanent singles — gets a permanent ban marked "do not delete".
- **Fix — provider ban was not seen when deciding a /24.** The run checked a
  block's singles against the provider ban before it had read the provider ban
  list, and before it knew the new attackers' owners; a block whose attacks the
  provider ban already closes was banned anyway and then listed as "no longer
  needed". Measured with real CSF.
- **Fix — rented-server list and ban guard used their own idea of "allowed".**
  Both run before CSF's allow list, so they exempt what CSF lets in. A
  single-port allow line (e.g. SSH only for a customer, or the plugin's own
  exception lines) exempted the address on every port, and `GLOBAL_ALLOW`,
  DynDNS and temp allows (`csf -ta`) were not exempted at all. One shared list
  (`tools/allow-list.sh`, used by both and by the leak check) now follows CSF:
  a full allow passes everywhere, a single-port allow only on its port. Tested
  per line type and with packets on real CSF.
- **Fix — `csfpost.sh` location.** CSF runs `/usr/local/csf/bin/csfpost.sh` when
  it exists and then ignores `/etc/csf/csfpost.sh` (read from CSF's source).
  The tools now write to the file CSF runs and clean the other one, so the
  rented-server rule, the ban guard and the block counter come back after
  `csf -r` on such servers too.
- **Fix — "still being attacked" counter of banned blocks.** The counting rule
  moved to the very top of mangle PREROUTING: attempts dropped by the
  rented-server list or the ban guard (which drop before CSF) are counted too,
  so a block attacked recently is not removed as old. CSF clears the counters on
  every reload; the plugin now reads them before each of its own reloads.
- The service of a single lfd made permanent (PERMBLOCK) is found the same way
  in the run and on the status screen (all rotated lfd logs, cached).
- The daily tasks are marked done only after they ran: a run cut short does
  them on the next run. The provider-data refresh gives lfd 12 hours to download
  before putting the old file back.
- Lifting a ban keeps the restore copy if the allow file could not be written;
  a temp ban counts as placed only if CSF really lists it.
- `tools/ban-leak.sh` reads every rotated lfd log (any naming, compressed or
  not) for temp bans.
- The status band says "CSF not found" when CSF is missing, instead of "rules
  not loaded".
- **Range card for any range.** Clicking a /26 or a /12 in a table opened the
  IP card of its first address; it now opens the range card for exactly that
  range (bans are offered for /16–/24 only). A /32 opens the IP card.
- **Review list:** the summary under "To review" counts each kind (suspicious /
  skipped / allowed attacker / open service); long lists show 20 rows with
  "show more" (ignored list: 10).
- **Clearer texts:** the save dialog and the settings history name every
  setting and show values in words ("Off → On", "5 min"), list settings as
  added / removed; error notices are sentences instead of codes; texts point
  to the real Settings section names; numbers that depend on a setting (review
  days, block threshold, suspicious-network threshold, warning days for list
  downloads) follow the setting; IPv6 input explains that only IPv4 is
  handled; "Remove" for an ignore reads "Stop ignoring".
- **Safer actions:** "Remove all" for bans no longer needed asks for typed
  confirmation when kept, manual or partial bans are among them and reports
  how many were removed; "Resume" says that CSF and lfd restart; leaving
  unsaved settings asks in the panel's own dialog.
- **Fresh data:** after a ban the reopened IP / range card shows the new ban;
  the "data from … ago" bar counts on during an outage; "Next run" is empty
  while paused; Measure impact shows when it was measured; a failed event log
  read is reported in History.
- **Phone:** the active bans table can be sorted from a "Sort" menu (the column
  headers are hidden on narrow screens); the save bar no longer covers the last
  fields; tapping a badge shows its explanation.
- Settings hide the Imunify refresh when Imunify is not installed and lock the
  schedule when there is no crontab; "Excluded from allowed services" is
  checked before saving.
- **Tests:** a test for the shared allow list (every CSF line type), state
  table rules for the /24 removal, watch records across ban / unban / keep /
  removal in CSF, and the range card; real-CSF scenarios for the provider ban
  in /24 decisions, lfd's history after a /24, single-port and temp allows on
  the rented-server list and the ban guard, the `csfpost.sh` location and the
  block counter in mangle.

## 1.13.10 — 2026-10-12

- **Review rows are re-checked against today's data:** an old warning stays
  only while its range still meets the rule (enough singles across at least
  two blocks) and the attacked services are not already closed by another
  layer; the attacked service of a PERMBLOCK single is read from the lfd log,
  otherwise the row says "service unknown".
- **New: range card.** Clicking a range (/16, /24 or an announced range)
  anywhere in the panel opened the IP card of its first address, which then
  talked about that one IP. It now opens the range itself: is the range
  banned (fully, partially, not), each attacked service closed or open for
  the whole range, what to look at, the bans inside it (single bans with
  reasons), its review entry, owner and the ban button.
- **Tests:** the state table now also checks that review rows are re-checked
  (singles below the rule, singles gone, attacks already closed, still valid)
  and that clicking a range opens the range card.
- Long layer badges in the IP and range cards wrap on narrow screens instead of
  running out of the card.

## 1.13.9 — 2026-10-12

- **Glossary window:** the two columns now run edge to edge with equal margins
  on both sides (the body was indented under the title), and the window is
  wider so the explanations take fewer lines.
- **Allowed-service tiles:** the Google and OpenAI descriptions fit on one line
  again (the sub-list chips below already name each list).
- **Review list is a table** with column headers like Active block bans:
  network · state · why (how many IPs, which services) · owner · flagged
  (relative time, full date on hover) · suggested ban · menu. Longer notes
  (blocks, permanent/temporary, the narrower range to ban, "covered by … but
  SSH is open") sit under the row. Clicking the IP count opens the IPs.
- **Fix — old suspicious-range warnings said nothing.** Warnings recorded before
  the event log (date only) showed no IP count, services or owner, and were not
  checked against provider bans and rented-server lists. They are now rebuilt
  from the single bans in CSF: IP list with reasons, counts, owner; a range
  whose attacks an active list or provider ban already closes drops out; one
  whose singles are gone says so.
- **IP card:** the result line now starts with the glossary terms — "fully
  banned", "partially banned" (what is closed, what stays open) or "not banned".
- **Column headers** also on the IP list under a row, the Ignored card (now a
  table with an explanation), and the Measure impact tables.
- The IP list showed "do not delete" in English in the Turkish panel; it reads
  "silinmez" with an explanation.

## 1.13.8 — 2026-10-12

- **Fix — the Imunify360 protection lost its place.** Imunify360 puts its own
  `INPUT` chain back on top within about a minute, so the 1.13.7 rules in
  `INPUT` (ban protection and rented-server lists) ended up behind it again.
  Both now live in the `mangle` table's `PREROUTING`: it runs before the
  redirect, so the original port is seen, and Imunify360 has no rules there.
  Only new incoming connections are checked; this server's own outgoing
  connections are not touched. Nothing is left in `INPUT` after the update.
- **Allowed-service sub-lists:** Google (4 lists) and OpenAI (GPTBot,
  OAI-SearchBot, ChatGPT-User) show each list as a chip on their tile; each can
  be switched off on its own (`SVC_SKIP`).
- **New: exclusions from allowed services** (`SVC_EXCEPT`): addresses or ranges
  that stay out of the allowed lists even when a list contains them; the
  covering range is split so the rest stays allowed. A ban on an allowed
  address has no effect (CSF applies allows first); the IP card, the review
  list and History offer "Exclude from allowed services" for such an address.
- **IP card redesigned:** the answer first (banned or not, and whether the ban
  actually works), then firewall layers, blocks, allow lists and the owner in
  their own sections. An allowed address no longer says "you can ban it by
  hand" while also saying bans have no effect.
- **Measure impact also shows past bans:** how many of the provider's addresses
  are banned in CSF, how many of those bans work, how many sit in a
  rented-server list and how many are on allowed-service addresses (no
  effect), with the services attacked and the bans one by one. When the last
  24 hours had no traffic but there were bans, the verdict says so.
- **"Service unknown" fills in over time:** the attacked service of a
  permanent repeat ban is read from the first temp ban in `lfd.log` and its
  rotated copies (also `.gz`) and kept in a cache, so it no longer disappears
  when the log rotates.
- **Glossary** is a proper button at the start of the header actions; with a
  window open the page scrolls once (no frame inside a frame).
- **`tools/ban-leak.sh`:** port rules for everyone (`s=0.0.0.0/0`) are no
  longer counted as bans; new section *banned but allowed* lists bans that sit
  inside an allow list, with the list.

## 1.13.7 — 2026-10-10

- **Fix — with Imunify360, port-based bans could be bypassed.** Imunify360
  redirects addresses on its grey / splash-screen / captcha lists to its
  WebShield ports and accepts them before CSF. Bans that look at the port
  (web-only partial bans, `CC_DENY_PORTS` provider and country bans, the
  rented-server lists) then did not match, and a banned address that passed the
  WebShield check could open the sites. A new chain at the
  top of `INPUT` (`tools/ban-guard.sh`) applies those bans to redirected
  connections on the original port, after CSF's allow list. Full bans were not
  affected.
- **Rented-server lists:** the rule moved from the end of CSF's `LOCALINPUT` to
  the top of `INPUT` and matches the original port. Addresses in `csf.allow`
  (and the files it includes) are exempt inside the set, since the rule now runs
  before CSF's allow list. Each run puts the rule back first if another tool's
  chain went in front of it.
- **New: `tools/ban-leak.sh`** (read only) — counts requests in the web logs
  that reached the sites while a ban was in force, layer by layer, and lists the
  rules that rewrite or accept traffic before CSF.
- **Settings regrouped:** Notifications · Ban rules (thresholds and the watch
  period) · Running · Sources and refresh (owner lookups, list refresh, CSF's
  ASN data, Imunify360) · Old bans · Records · Server · Settings history, with
  small headings inside each section. The list refresh settings moved here
  from the Providers cards (the cards link to it); saving them no longer
  restarts CSF and lfd.
- **Clearer screens.** Measure impact opens with the question and its answer
  (what a ban would change), splits requests into allowed services, addresses
  already closed by a rented-server list and the rest, gives a verdict, and
  keeps the raw lists in closed sections. Ranking rows show one fact per line.
  Country, provider (ASN), filter-count and Imunify360 reason badges explain
  themselves on hover; "do not delete" reads "kept" with an explanation; the
  History rows put the owner on its own line; list tiles say "not selected"
  instead of a dash.
- **Measure impact:** requests are split into allowed services, addresses in an
  active rented-server list, and the rest. The request examples now show the
  right site (they sometimes showed the previous log line's site) and each
  address's current state (temp ban and time left, permanent ban, block ban,
  Imunify360 block list).

## 1.13.6 — 2026-10-09

- **The panel opens much faster.** Reading the server's state repeated costly
  work per provider and per single ban: the lfd log was searched once per
  PERMBLOCK address, each banned provider's whole address set was listed just
  to count it, the rented-server share compared every range with every list
  range, and the provider ranking was computed twice. All of these now run in
  one pass. On a test server with 1,500 bans, 450,000 lfd log lines and 6,000
  Imunify360 entries, the state went from about 2 minutes to under 8 seconds;
  the output is the same. Set `AG_PROF=1` when running
  `csf_autogroup.sh --status --json` to see where the time goes.
- **Fix — "already in a rented-server list" share was too high** when list
  ranges overlapped (the same addresses were counted once per list). It is now
  the exact share of the provider's addresses inside the lists.

- **Refresh and timing periods are settings now** (they were fixed in the
  code). Rented-server and allowed-service cards get a *Refresh* section:
  how often the lists are downloaded again (default every day) and after how
  many days of failed downloads it is reported (default 3). The provider-ban
  card: how old CSF's ASN data may get before lfd downloads it again (default
  25 days). Settings → Lookups: how long a block's owner is kept (30 days) and
  how often Imunify360's list is read (60 minutes). Settings → Retention: how
  recent an attempt keeps a block from being "old" (30 days). All are also
  `config.env` keys (`CLOUD_REFRESH_DAYS`, `CLOUD_FAIL_DAYS`,
  `SVC_REFRESH_DAYS`, `SVC_FAIL_DAYS`, `GEO_REFRESH_DAYS`, `OWNER_TTL_DAYS`,
  `IMUNIFY_REFRESH_MIN`, `BLOCK_ACTIVE_DAYS`).
- **Most blocked providers:** each row shows the attacked services with their
  counts (web, mail, SSH…) and when the last attack was.
- **Measure impact** also lists examples of failed requests (403, 404, 5xx…)
  with the site, the request and an example IP — not only the successful ones.
- Waiting screens (opening, actions, Measure impact) no longer count seconds;
  they only say what is being waited for.

## 1.13.5 — 2026-10-09

- **Fix — the server's own provider could be banned.** The protection asked
  Team Cymru (DNS) for the server's provider; on a fresh install with DNS not
  answering it stayed empty. It now falls back to CSF's own ASN data
  (`ip2asn`), and if that is missing too, no new provider is added to the ban
  (those already applied stay) and the reason is shown.
- **Fix — country bans were not taken into account** when deciding whether a
  suspicious network is already closed: a network in a country listed in
  `CC_DENY` (or in `CC_DENY_PORTS` for the attacked ports) no longer stays in
  *Needs review*.
- **Fix — port ranges** (`1000:2000` in CSF's port lists, `30000_35000` in a
  partial ban) are understood when checking whether a service is closed.
- **Automatic block bans count only attacks on open services.** Single bans
  whose service is already closed by a wider layer (provider ban, active
  rented-server list, country ban, or a partial ban covering the block) are
  attacks from before that layer existed; they no longer push a block over the
  threshold. Attacks on a service that is still open (e.g. SSH under a web-only
  list) still do. Same rule as for suspicious networks.
- **Most blocked providers:** a provider banned with the port list only shows
  up again when attacks continue on services that list leaves open, tagged
  "banned on TCP 80,443; attacks on open services". Attacks on the closed ports
  are not counted. Providers banned on everything stay out of the ranking.
- **Bans no longer needed** also lists blocks inside a `/16` (or wider) ban;
  *Remove all* covers them.
- **Old block removal keeps blocks that are still being tried.** A banned
  block's traffic is dropped by the firewall and never reaches lfd, so the
  plugin now counts it itself: an `ag_hits` ipset with a counter per banned
  range and one rule at the top of `LOCALINPUT` that only counts (it neither
  blocks nor allows; tested against a real CSF — bans keep working, the counter
  rises per block). CSF deletes both on every reload; a `csfpost.sh` line
  rebuilds them from `csf.deny`, and each run reads the counters first. A
  block with an attempt in the last 30 days is not "old" and is not removed;
  its last attempt shows in the state tip of Active block bans. Pausing the
  plugin removes the rule and the set.
- **Old block removal keeps "do not delete" blocks** (blocks that came back and
  were made permanent, and blocks marked by hand); the *Old* filter matches.
- The ban window picks the widest ban already covering a range (it depended on
  the order of lines in `csf.deny`).
- The IP card uses the engine's `csf.rignore` matching (regular expression and
  forward check, like lfd) instead of a plain suffix match.
- A rented-server list that fails to download is retried at most once an hour
  for the same settings (a changed source was retried every run, holding the
  lock up to 5 minutes when the server can't reach out).
- A provider banned with the port list and also inside a rented-server list is
  no longer reported as "port missing" for a service the list closes.
- **Settings → Server → CSF list limits** shows how full each list is
  ("9 / 1,000 lines · 1%" with a bar; orange from 80%, red from 90%, as on
  Overview).
- LFD PERMBLOCK: when the IP's earlier temp blocks are no longer in the log,
  the service is taken from the PERMBLOCK line's own trigger tag
  (`[LF_SSHD]`). Checked against a real CSF/lfd, which also confirmed the
  csf.deny and lfd.log formats the engine reads, that the rented-server rule
  survives `csf -r` and a full restart via `csfpost.sh`, that it drops new
  connections from listed addresses while `csf.allow` still lets them in, and
  that a newly added provider's set stays empty until lfd restarts (~12 s)
  while filled sets are never emptied by a reload.
- **Fix — the first run after turning on a rented-server list** didn't count
  it: whether the list is really active was decided before the run applied it,
  so that run could add a block ban the list already made unnecessary. It is
  now decided again right after the list is applied.
- **Fix — a warning mail with no matching row in *Needs review* (or the other
  way round).** With a partial ban on a network, the engine checked whether a
  wider layer closes the attacks using the attacks from *before* the ban too,
  while the warning and *Needs review* use only those after it. Both now use the
  attacks after the ban.
- A watched block whose watch period ran out during a run gets a new temp ban
  instead of being made permanent (expired watch entries were only cleared at
  the end of the run).
- Tests: `tests/senaryo/gercek.sh` runs the scenario matrix against a real
  CSF/lfd (16.33) in a local test VM.
- Tests: `tests/senaryo/calistir.sh` grew to ~50 scenarios (country bans,
  own-provider protection, ranking, old blocks, block thresholds, ban window,
  `csf.rignore`); `tests/senaryo/birim.sh` checks the port-range helper. The
  test stand-ins give the server an IP and provider (`ip`, `dig`).

## 1.13.4 — 2026-10-08

- **Waiting box in the middle of the screen:** while an action runs, a box in
  the centre says what is being done and what it waits for — CSF rebuilding
  its rules after a ban change, CSF plus an LFD restart after provider
  settings, or "CSF is not touched" for ignore / stop watching — with the
  seconds passed. The old line at the top of the page could sit under WHM's
  header.
- **"Empty in CSF" right after a reload:** while LFD has just restarted, the
  provider sets are still being filled; the Providers tab now says
  "CSF is loading…" instead of "empty / not loaded" and checks again every 10
  seconds until they are filled. The status output carries how long LFD has
  been running (`health.lfd_age`).
- **Active block bans:** the "in a provider ban" / "in a rented-server list"
  tag no longer pushes the owner's name out of a narrow column; on tagged rows
  the AS number moves to the tip, the tag is shorter.
- **Fix — allowed services were not treated as whitelisted.** Lines of the
  plugin's own allow file (Googlebot, Bing, payment notifications…) and its
  `Include` line were skipped together with the plugin's port exceptions, so a
  block of an allowed service could get a block ban. Now only the port
  exceptions are skipped; the allowed services count as whitelist, a block
  there is "skipped (whitelist)" and names the service.
- **Fix — rented-server lists counted as closed when they weren't.** With the
  plugin paused, or when the `ag_cloud` set isn't loaded in the firewall, the
  downloaded list files still made networks look closed: warnings were hidden
  and *Bans no longer needed* could suggest removing bans. Coverage now
  requires the list to be really active.
- **Fix — attack type from the wrong part of the note.** The country and
  reverse-DNS part of an lfd note ("…from IP (US/United States/mail.smtp…)")
  and words in a ModSecurity rule message ("cPanel", "spam") could put an
  attack on the wrong service. ModSecurity is always web; the country/rDNS part
  is ignored (engine and panel alike).
- **IP card:** an IP in `csf.ignore` (or GLOBAL_IGNORE) is no longer reported as
  "allowed" — those only stop lfd; firewall bans still apply. A port-only allow
  line is not a full allow either; both get a note under the result.
- The English panel calls the card *Needs review* everywhere (some texts said
  "To review").
- **Fix — LFD PERMBLOCK:** an IP that LFD made permanent after repeated temp
  blocks (LF_PERMBLOCK) was treated as "service unknown", so a suspicious
  network whose attacks were all closed (e.g. web attacks inside a rented-server
  list) stayed in *Needs review*. The real service is now read from the IP's
  last temp block in `/var/log/lfd.log`; if the log no longer has it, the IP is
  left out of the check (it is permanently banned on its own). A network with
  attacks on a service that is still open stays visible and names it.
- **Measure impact:** response codes are shown separately for allowed services
  (Bingbot, DuckDuckBot…) and for everyone else, with the request count per
  allowed service; while it runs it says what it reads and the seconds passed.
- **IP card:** when the IP is in a rented-server list, the tag and the result
  say so ("This IP is in the DigitalOcean rented-server list · blocked: tcp
  80,443"); before, "Rented-server list · DigitalOcean" read like the owner.
- **Most blocked providers:** the tabs wrap instead of cutting *Banned* off in
  a narrow column; *Banned* lost its own count (the header shows the selected
  tab's total, like the others); the Imunify360 note no longer says
  "information only" next to rows that have a *Ban…* button.

## 1.13.3 — 2026-10-07

- **Full lists, short at first:** Most blocked providers, provider ban events
  and Bans no longer needed show the first few rows with the total in the
  header; *More*, *Show all* and *Collapse* sit under the list. The ranking now
  holds every provider (was cut at 10, so "show all" had nothing more).
- **One name per concept:** *Cloud lists* is now **Rented servers** (the
  servers cloud companies rent to anyone), "inside a cloud list" is
  **Bans no longer needed**, *Needs attention* is **Needs review** everywhere
  (panel, mail, log). The Providers tab opens with one sentence on how the three
  layers fit together, rented servers first.
- A provider in the ranking that is partly inside a rented-server list says how
  much of its address space is already closed there, so a provider ban that
  would add little is visible before you add it.
- **Terms** button in the header: a short glossary of the words the panel uses.
- Active block bans says in one line what it lists.
- The browser tab shows the plugin's name ("WHM [server] CSF Auto-Group -
  138.0.13"); WHM's page template left the name out.
- History shows owners with their short name, as the tables do
  ("AS15169 Google LLC, US").
- **Phone:** filters and tabs wrap to a second line instead of hiding off the
  edge; Active block bans rows give the owner a full line (names were cut to one
  letter) and drop the empty "—"; the run band's three values no longer overlap.
- Wider screens: the block column fits "temp ban: 11 h 58 min left"; the layer
  cards' warning ("4 lists can't be downloaded") wraps instead of being cut.
- New checks for development: `tests/ayar-tutarliligi` (every setting value
  the panel can send passes both the panel and the engine) and `tests/metin`
  (no old concept names left).

## 1.13.2 — 2026-10-07

- **Fix:** turning on Microsoft 365 in Allowed services couldn't be saved
  ("bad_value: SVC_SOURCES") — the panel's check didn't allow digits in source
  names. The save dialog lists what was added and removed in lists instead of
  the whole list on one line.
- **Active block bans:** every row is one line again. The state is one badge
  ("partial · Web", "temp · 5 h", full text in its tip); "inside /16",
  "in the provider ban", "in a cloud list" moved next to the owner; owners show
  their short name ("DigitalOcean, LLC").
- **Most blocked providers:** tabs say what they hold — *Attacks*, *Added by
  hand* (was "Other blocks"), *Imunify360* and a new *Banned* tab (the banned
  providers used to be stuck under the list); each tab has a one-line note,
  on Overview too. Every row has a reason (from the single bans' notes when the
  event log has none, else "no reason recorded"), a blue "69 in the Azure
  list" tag when part of it is closed by a cloud list, short names, and at most
  two lines.
- Providers tab: the layer cards are buttons (no underlined text), and jumping
  to a card leaves room for WHM's fixed header.

## 1.13.1 — 2026-10-07

**Overview and History simplified:**

- The *Rules* card is gone from Overview (the same values are in Settings →
  Thresholds).
- The 7 / 30 day choice sits in the chart's header instead of its own line.
- The *Active block bans* and *Needs review* cards lost their rings (they
  didn't say much); the permanent and temp list cards keep theirs.
- *Active block bans* hides filters with nothing in them (All and the selected
  one always stay).
- *Most blocked providers* on Overview shows the top 5 without the long
  explanation; the full ranking is in Providers.
- History folds runs of the same clean-up event in the same minute (temp bans
  removed, old blocks, UDP 443 fixes) into one row — "3 entries · Temp ban
  removed" — that opens to the addresses.

## 1.13.0 — 2026-10-06

**Providers tab redesigned:**

- Three layer cards at the top — provider ban, cloud lists, allowed services —
  each saying whether it's on, how much it covers and whether something needs
  attention (providers CSF hasn't loaded, lists that don't download); a click
  scrolls to the card.
- Every layer card has the same shape: on/off in the header, a one-line
  summary, the long explanation folded under "How it works", then sections.
- Providers are added with a box (**Add and measure**) and removed with ×; the
  comma-separated field is gone. Each row shows CSF's state, the mode and
  **Measure impact** in one line.
- Provider ban and cloud lists pick blocked ports with the same control: *Web
  only* or *Selected ports*, with what stays open spelled out.
- Source tiles sit in an even grid with the address count, last download or
  download error. Every tile has an **Address** button that opens that source's
  download address(es) right below for editing ("Reset" puts the default back)
  — no plugin update needed when a provider moves its list.
- **Extra lists** for cloud lists (`CLOUD_EXTRA`, `name|https://url`, plain IP
  list or JSON) for companies that aren't built in.
- Every cloud list tile says how many attackers from the event log and the
  current bans are in that list — including lists that aren't selected (they
  are downloaded once a day just to count, never written to CSF), so you can
  see which ones are worth turning on.

## 1.12.8 — 2026-10-06

- **Microsoft 365 in Allowed services** (Outlook, Exchange Online). The new
  Outlook and Outlook mobile sync and send IMAP accounts' mail through
  Microsoft 365 servers; 6 of Microsoft's 16 Exchange Online ranges sit inside
  the Azure list. With this source on, mail ports (465, 587) can be added to
  the cloud list ports without cutting Outlook users off. The cloud list card
  warns when Azure is selected, mail ports are blocked and Microsoft 365 isn't
  allowed. (This source accepts ranges down to /12, as Microsoft publishes them.)

## 1.12.7 — 2026-10-06

Screens that know about each other:

- **Needs review:** when every attacker of a network is already in a banned
  provider or a cloud list but the attacks hit a port those don't block (SSH
  while only web is closed), the row says so and which ports to add.
- **Rankings:** a single ban counts as covered by a cloud list only when the
  attacked service's ports are in the list's port list (SSH attacks stay
  counted while only web is blocked).
- **Ban window:** a range inside an active cloud list says which ports the list
  already blocks, so a ban is only for the rest.
- **Bans inside a cloud list:** partial bans whose ports the cloud list also
  blocks are marked "inside a cloud list" and listed with the provider-ban ones
  in the Providers tab (Remove / Remove all).
- **Measure impact:** a successful POST from an address that isn't allowed shows
  the IP and **Add to allowed services** (goes into Extra addresses, applies on
  save); a client that calls itself Googlebot, Bingbot, DuckDuckBot… but isn't
  allowed says whether that source is off in Allowed services or the bot may be
  fake.

## 1.12.6 — 2026-10-06

- **Measure impact marks allowed services:** requests from addresses in the
  allowed services (DuckDuckBot, Googlebot, payment webhooks…) are tagged
  "allowed · duckduckgo — not blocked" in the non-browser clients and
  successful POST lists, and the summary says how many requests the ban won't
  touch because CSF lets them through first.

## 1.12.5 — 2026-10-06

- **The rankings know about cloud lists:** block and single bans whose IPs are
  in an active cloud list aren't counted (those servers are already blocked);
  a row shows how many are ("12 in a cloud list"). A provider whose bans all
  fall in cloud lists leaves the ranking and appears on the banned line as
  "Azure list" — e.g. Microsoft after switching from the AS8075 ban to the
  Azure list.

## 1.12.4 — 2026-10-05

- **Pause switch** (Settings → Schedule, `ENABLED`): while paused, runs add no
  bans and send no warnings, and the provider ban and the cloud list ban are
  removed from CSF right away. Allowed services and existing block bans stay.
  Overview says it is paused and has a **Resume** button; resuming puts
  everything back as set.

## 1.12.3 — 2026-10-05

- **Cloud list ban never catches allowed services:** 23 of Google's crawler
  ranges sit inside Google Cloud ranges. CSF's allow list already comes first;
  now the allowed-service addresses are also taken out of the cloud set
  (`nomatch`), so Googlebot stays reachable even if the allow list were empty.
- Provider ban events show what changed ("removed: AS8075 · 5 providers in
  all") instead of the whole list each time.

## 1.12.2 — 2026-10-05

- **Azure in the cloud lists:** Microsoft's AzureCloud addresses (all Azure
  datacenters). Microsoft publishes the file weekly under a new name; the tool
  reads the current link from the download page (a direct .json address can be
  entered instead). Bingbot's addresses are inside AzureCloud: the card warns
  when Bing isn't on in Allowed services. Narrower than banning AS8075, which
  also holds Outlook, Office 365 and Teams.
- **Measure impact also shows why the provider is there:** how many of its IPs
  were banned (from the event log), the top ban reasons, the services attacked,
  and whether the web-only port list is enough or other ports are hit too.
- Provider ban events no longer list the one-time UDP 443 fix of partial bans;
  newest first.

## 1.12.1 — 2026-10-05

- **Needs review groups a suspicious network's IPs by announced range:** when
  most of them (60%+) sit in one range the owner announces between /17 and
  /23, the row says so and offers **Ban announced range** next to *Ban
  network*. The IP lines of new warnings carry their announced range; the
  owner cache keeps it (filled in as blocks are looked up again).
- **Bans inside the provider ban:** each row names the provider (linked to
  bgp.he.net) and the range opens its IP card. On Overview, the banned
  provider badges open the Providers tab.
- Cloud list texts say what the lists are: servers the cloud companies rent
  out to anyone, not your visitors.

## 1.12.0 — 2026-10-05

- **Cloud list ban (experimental, Providers tab):** blocks the addresses cloud
  companies rent out to anyone (virtual servers), from the lists they publish — Google Cloud,
  AWS (EC2 only), Oracle Cloud, DigitalOcean, Linode and Vultr — on ports you
  choose (default web: TCP 80, 443 and UDP 443). The providers' own services
  aren't in these lists (the Google Cloud list has no Googlebot or Gmail), so
  it reaches cloud servers announced under a provider's main ASN without
  banning that ASN. `tools/cloud-ban.sh` loads the lists into an ipset and adds
  one rule at the end of CSF's `LOCALINPUT` chain, after the allow list; only
  new incoming connections are dropped, so this server's own connections to
  those clouds keep working, and its own IPs are excluded. A line in
  `/etc/csf/csfpost.sh` restores the rule when CSF restarts (an existing
  Imunify360 line stays last). Lists are refreshed daily; source addresses can
  be edited; a list that can't be downloaded for 3 days is reported. Turning it
  off removes the rule, the set and the line. Needs review, the IP card
  (result line) and the weekly summary know about it.
- **Ban announced range** on the IP card: when the range the owner announces is
  between /17 and /23 (176.88.120.0/21), it can be banned instead of the whole
  /16 — same window as the /16 ban (what's inside, whitelist, partial ban,
  removing covered entries), "Change ban" and "Remove ban" work on it.

Provider ban everywhere:

- **Banned providers leave the rankings.** Most blocked providers (CSF, Other
  blocks, Imunify) and the weekly summary rank only providers that aren't
  banned in CSF (`CC_DENY` / `CC_DENY_PORTS`), so the list doesn't fill up
  with them and the suggestion always points at the next one. A line under the
  list names the banned ones and what is blocked for each ("everything" or the
  port list); a provider CSF hasn't loaded yet is flagged.
- **Needs review drops what the provider ban already blocks.** A suspicious
  network or skipped block is left out when every attacking IP belongs to a
  banned provider and the ban covers the attacked service (*Everything*, or a
  port list that holds that service's ports: a Web-only ban covers web
  attacks, not SSH ones). The run doesn't send a warning for it either; the
  log says why.
- **The weekly summary has a Provider ban card**: banned providers, what is
  blocked, ranges loaded by CSF, the allowed-services address count with the
  last download, and sources that couldn't be downloaded for 3 days.
- Overview's *Active block bans* card shows how many providers are banned,
  linking to the Providers tab.
- **Bans inside the provider ban are marked** ("inside a provider ban" in
  Active block bans) when the ranges CSF loaded for a banned provider hold the
  whole range and the provider ban blocks everything the ban blocks (a full ban
  needs *Everything*; a partial ban needs its ports in the port list). The
  Providers tab lists them with **Remove** and **Remove all**; entries a manual
  ban had removed are restored.
- "Source addresses" is now "Show and edit source addresses".
- A source that fails is reported 3 days after its **first failure** (a source
  that never downloaded is no longer reported on the first run).
- "Source addresses" no longer overlaps the source tiles.

## 1.11.0 — 2026-10-05

- **New Providers tab** (Overview · History · Providers · Settings): provider
  ban and allowed services, next to the most blocked providers — **Ban…** on a
  row adds it to the list and measures the impact — and the provider ban
  events. It moved out of Settings; Overview's provider card links to it.
- The "ban the whole provider" suggestion (providers with 5+ block bans) no
  longer tells you to edit CSF by hand: **Add to provider ban** opens the
  Providers tab with the provider added and its impact measured.
- **IP card says the result first**: "can connect — the whitelist comes before
  every ban", "blocked on every port (CC_DENY FR)" or "only Web is blocked;
  other connections are open". Raw CSF lines are folded under "CSF line". When
  the network is already fully blocked it says why there are no ban buttons; a
  provider rule whose addresses CSF hasn't loaded yet is flagged.
- **Removing a ban restores the removed entries by default**, lists them, and
  says that unticking unbans them too.
- **Change ban** says what the ban is now and disables **Change** while the
  selection matches it.
- The partial-ban suggestion in the ban dialog has its own button ("Block only
  SSH"). "Remove covered entries" is two lines; the rest is under "Details".
- One name for blocks made permanent after coming back: "Came back, permanent"
  (table, chart, History).
- Watched blocks: the column is "Watch ends", and the card gives the live number
  of temp bans that makes a block permanent.
- Active block bans mark blocks inside a country or provider ban; a temp ban's
  remaining time sits under its badge instead of being cut off.
- The save dialog says provider settings apply right away and the others on the
  next run. The threshold-impact line no longer covers the value field.
- History no longer shows the first run's events twice (once from the event
  log, once rebuilt from the plain log); its cache is rebuilt once.
- **Allowed services show when they were last downloaded** (at the top of the
  card, and per source on each tile with its address count).
- **Source addresses can be edited** under "Source addresses": if a provider
  moves its list, type the new address; "Reset" goes back to the built-in one
  (`SVC_URLS`).
- **A source that can't be downloaded for 3 days is reported**: mail once a
  day, Slack when it starts and when it is fixed, a bar on Overview and an
  event in History. The previous list stays in csf.allow meanwhile.
- Provider rows in the Providers tab are aligned: name and CSF state on the
  left, mode and **Measure impact** on the right of every row.

## 1.10.2 — 2026-10-05

Fixes from a full logic and consistency review:

- Provider ban never overwrites CSF's `CC_DENY_PORTS_TCP/UDP` when it didn't set
  them: with only *Everything* providers, your own port list was emptied on the
  second run. The previous values are saved only when the plugin first writes
  the shared list, and restored only then.
- With the shared port list in conflict, a provider moved from *Everything* to
  *Port list* stays banned (in `CC_DENY`) until the conflict is resolved.
- An empty port list or source list stays empty instead of falling back to the
  default (an empty UDP list no longer blocks UDP 443).
- If no allowed-service list can be downloaded, it is retried at most hourly
  instead of on every run (which held the run lock for minutes).
- If CSF's ASN data couldn't be downloaded after a refresh, the previous file is
  put back.
- **Measure impact** counts all web logs (they were split into batches and only
  the last batch was counted) and only the lines of the last 24 hours.
- This server's own provider: the last known value is used when DNS can't be
  queried. lfd restarts no longer inherit the run lock.
- A service list that shrinks by more than half is accepted after the same
  result three times in a row (it was kept on the old list forever).
- Ignored blocks were counted in the threshold-impact numbers in Settings.
- Panel: the provider list field no longer rewrites your text while typing;
  the port fields keep their help text; reordering lists no longer counts as a
  change; "Working…" stays until the provider settings are applied (and doesn't
  leave controls disabled); a busy run is reported as "applied on the next run".
- Colors: a partial manual ban is blue in History, a removed provider ban is
  neutral, the "repeats" badge on suspicious networks is amber.
- Phone: allowed-service tiles wrap instead of overlapping; the chart's day
  breakdown is centered for middle bars; wider value axis.
- "Son ziyaretinizden beri" (formal you) in Turkish.
- From a usability review on rendered screens: the restore option counted one
  entry too many (the copy's header line); the IP card no longer says a
  whitelisted block will be banned automatically (it never is — it goes to To
  review); the temp-ban time on the IP card is in the panel's language; "Ban
  anyway" says the whitelisted addresses stay open instead of "nothing"; the
  provider port fields show examples instead of values that look real; the
  automatic block ban comment no longer repeats "do not delete".

## 1.10.1 — 2026-10-05

- **Provider ban: what to block is chosen per provider** — *Port list* or
  *Everything*. CSF has a single port list for port-limited bans, so *Web only* /
  *Selected ports* is shared by the providers on *Port list*; the screen says so.
  Up to 50 providers. A provider in `CC_DENY` set up by hand is adopted as
  *Everything*.
- Fixed: saving one provider setting left the others on "follow CSF", so a later
  change to CSF's port list by hand was taken as the wanted list. Saving any of
  them now writes them all. When the shared port list conflicts, providers the
  plugin had already applied there stay in place.
- **Measure impact** can be hidden again, and measured again.
- Allowed services: UptimeRobot, Pingdom and StatusCake (site monitoring).

## 1.10.0 — 2026-10-05

- **Provider ban (experimental), managed from Settings → Provider ban.** Bans a
  provider by AS number with CSF: web only (TCP 80, 443, UDP 443), selected
  ports, or everything. **Measure impact** first shows the provider's requests
  to your sites over the last 24 hours (codes, successful POSTs such as payment
  notifications, non-browser clients, by site). Saving writes the setting to CSF
  at once and restarts lfd so the address sets fill; the screen shows how many
  ranges are loaded. Turning it off removes only what the plugin added; a shared
  `CC_DENY_PORTS` port list used differently by another entry blocks the change
  and says why; this server's own provider is never banned. A provider ban set
  up by hand in CSF is adopted.
- **Allowed services** in the same section: Google, Bing, Apple, DuckDuckGo,
  OpenAI, Stripe and Mollie lists plus your own entries, written to a file
  included from `csf.allow` and refreshed daily; per-source counts and last
  update on screen.
- The wanted state lives in `config.env` and every run makes CSF match it, so a
  restored `config.env` brings both back after a server move.
- Values with spaces are written to `config.env` quoted.

## 1.9.18 — 2026-10-05

- Once a day the run does two upkeep jobs, so no separate cron lines are needed:
  - refreshes the published service addresses when `tools/services-allow.sh`
    is in use (its include line is in `csf.allow`);
  - with an ASN ban (`CC_DENY` / `CC_DENY_PORTS`), refreshes CSF's ASN data when
    it is older than 25 days. lfd downloads `ip2asn-combined.tsv` only when it
    is missing, so an ASN ban otherwise keeps using old addresses; the file is
    moved aside and lfd restarted, which downloads current data (put back if lfd
    can't be restarted).

## 1.9.17 — 2026-10-05

- New `tools/services-allow.sh`: keeps the addresses that services publish
  (Google's crawler and fetcher lists, Mollie, plus your own entries) in a file
  included from `csf.allow`, so a provider-wide ban such as a cloud ASN in
  `CC_DENY_PORTS` doesn't cut them. Plain addresses (ipset), keeps the previous
  list when a download fails, refuses ranges wider than /16, restarts CSF only
  on change. See README, "Allowing published service addresses".

## 1.9.16 — 2026-10-05

- Pressing **Ban** (or any action) dims the action buttons right away with a
  "Working…" note, instead of only after the server finished; then "Done,
  updating the list…" until the new state arrives.
- Each manual action writes its duration to the log, split by CSF call
  (e.g. `Manual action time (ban16 104.208): 14,2 s · csf -r 1× 9,1 s ·
  csf -tr 5× 4,0 s`), so a slow ban shows where the time went.

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
