# CSF Auto-Group

Automatically consolidates attacker IPs into subnet bans for **ConfigServer
Security & Firewall (CSF)**, so a brute-force flood doesn't overflow your
`csf.deny` line limit.

When dozens of IPs from the same `/24` hammer your server, blocking them one by
one fills the deny list fast. This script groups them: several banned singles in
a `/24` → ban the whole `/24` and drop the singles (freeing slots). Repeat
offenders escalate from temporary to permanent; `/16` ranges are only flagged
for review (never auto-banned — too broad). It also emails you when the deny
list nears its limit.

Works on **any CSF server** (cPanel or not). No dependencies beyond CSF and a
working `mail` command.

---

## ⚠️ Read this first

This script **modifies your firewall** — it auto-bans entire `/24` subnets (256
addresses). A misconfigured threshold, or a legitimate visitor whose IP falls in
a banned `/24`, can lock people out.

- **Whitelist your own IPs** in `/etc/csf/csf.allow` (CSF allow overrides deny).
- **Start with high thresholds** and watch `/var/log/csf_autogroup.log` for a
  few days before trusting it.
- `/16` is warn-only by design; only `/24` and single IPs are auto-banned.

## What it does

| Trigger | Action |
|--------|--------|
| `/24` with **≥3** permanent single bans | permanently ban the `/24`, remove the singles |
| `/24` with **≥5** permanent singles | ban `/24` + `do not delete` |
| `/16` with **≥5** singles across **≥2** `/24`s | warn by email (once/day) — no auto-ban |
| `/24` with **≥3** temp bans (first time) | temp-ban the `/24` for 12h, remember it |
| same `/24` seen again | promote to permanent ban + `do not delete` |
| temp `/16` with **≥5** singles / **≥2** `/24`s | warn by email (once/day) |
| deny list **≥80%** of its limit | email alert |

Singles already covered by a broader permanent block are cleaned up, the counter
is pruned (default 180 days), and the log is capped (default 5000 lines).

## Install

```bash
git clone https://github.com/ayzeta/csf-autogroup.git
cd csf-autogroup
sudo bash install.sh
```

The installer asks for the language (`en`/`tr`), alert email, and cron interval,
writes `config.env`, and installs the root cron job. Re-run it any time.

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

Run once by hand to see it work: `./csf_autogroup.sh` (watch the log).

## Uninstall

```bash
crontab -l | grep -v 'csf_autogroup.sh' | crontab -
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
