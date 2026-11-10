# Roadmap

Ideas that are planned or being considered. Nothing here is promised yet.

## IPv6
The engine groups and bans IPv4 only. IPv6 attackers are banned by LFD one
address at a time and never grouped — and an IPv6 attacker can change its
address on every attempt inside its own `/64` (one customer usually gets at
least a `/64`), so single bans fill CSF's list without stopping it.

Planned, in this order:
- **Firewall check:** when CSF has IPv6 enabled and the server has a public
  IPv6 address, warn if `TCP6_IN` / `UDP6_IN` open more than `TCP_IN` /
  `UDP_IN` (a common setup leaves every IPv6 port open while IPv4 is limited).
- **Block bans per `/64`:** a few single bans from the same `/64` ban the
  `/64` (it is one customer, so the risk of hitting others is low), with the
  same temp → watched → permanent steps as IPv4 blocks.
- **Suspicious networks per `/48`:** attacks from many `/64`s of one `/48`
  are reported for review, like a `/16` for IPv4; never banned automatically.
- **Coverage:** provider bans (CSF's ASN sets are IPv4 and IPv6), rented-server
  lists (several providers publish IPv6 ranges) and allowed services checked
  for IPv6 the same way.
- Panel, IP card and ban window for IPv6 addresses and ranges.

Thresholds and the `/64` / `/48` choice will be tested against a real CSF with
IPv6 before release.

## Log page in the panel
The plugin's own log (`/var/log/csf_autogroup.log`) has the step-by-step
record of every run: how long each step took, what CSF answered, which list
could not be downloaded. Today it is only readable over SSH
(`csf-autogroup log`). A read-only page in the panel would show it without
SSH:
- the lines of one run (picked from the run-duration chart), or a time range;
- a search box, and the log's rotated archives;
- a long run's slowest steps highlighted, so the run-duration tooltip can link
  to the reason when a run took longer than usual.

The log can contain addresses and email account names; the page is shown only
to the WHM root user, like the rest of the plugin.

## More notification channels
Besides email and Slack, WHM can be set up with a "Post URL" (generic webhook)
channel, which is how services such as Discord or Microsoft Teams are usually
connected. Each service expects its own message format, so this will only be
added once it can be tested against the real services.
