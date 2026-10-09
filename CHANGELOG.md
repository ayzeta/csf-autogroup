# Changelog

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
