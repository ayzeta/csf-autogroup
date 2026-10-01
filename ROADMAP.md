# Roadmap

Ideas that are planned or being considered. Nothing here is promised yet.

## IPv6
The engine groups and bans IPv4 only. IPv6 attackers are banned by LFD one
address at a time and never grouped. Grouping would need its own rules (a
`/64` is often a single customer, so the IPv4 thresholds don't translate
directly). To be discussed before implementation.

## More notification channels
Besides email and Slack, WHM can be set up with a "Post URL" (generic webhook)
channel, which is how services such as Discord or Microsoft Teams are usually
connected. Each service expects its own message format, so this will only be
added once it can be tested against the real services.
