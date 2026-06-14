# Pregnancy & Heir System

**Status: mostly future.** The *worldbuilding* is in
[`../world/30-bloodline-pregnancy.md`](../world/30-bloodline-pregnancy.md). This
doc is the gameplay-layer design; almost none of it is implemented.

## What exists today

- Bloodline resources only: `legitimacy` (0–100) and `menstrualStatus`
  (`normal` | `irregular` | `absent`).
- Effects can adjust them: `resource`/`bloodline`/`legitimacy` and
  `set_bloodline_status`.
- That is the entire implemented surface. There is **no** pregnancy lifecycle,
  no 胎息, no 承养 mechanic, no heir tracking.

## Designed lifecycle (future — do not author against)

1. **Pregnancy begins** — sovereign chooses 自孕 or (later) 承养.
2. **胎息 detected / 初定** — eligibility for 转胎 (placeholder: after 三月).
3. **承养 transfer** — a chosen man becomes the irreplaceable 承养人.
4. **Candidate eligibility** — by 承养 resilience, favor, family value.
5. **Health/status effects** — long 血养 weakens the 承养人.
6. **Heir implications** — birth, legitimacy, succession order.
7. **Event hooks** — 下旬 checks: 经血 status, 胎息 stability, 承养人 health, 皇嗣 growth.

## How to handle pregnancy content now

Until this system exists, model pregnancy/heir beats as **scripted events** using
only implemented tools: `set_bloodline_status` / `legitimacy` effects, flags,
`hasMemoryTag`, and `eventFired`. Do not introduce 胎息/承养 as if they were
engine state.
