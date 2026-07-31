# Tournament Feature

The tournament system allows guild members to compete in structured single-elimination tournaments with automated bracket generation, match reporting, deadline enforcement, and Discord integration.

## Architecture Overview

The tournament system consists of these components:

| Component                | File                                                | Purpose                                                      |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| TournamentManager        | `src/core/tournament/tournament-manager.ts`         | Central orchestrator                                         |
| BracketGenerator         | `src/core/tournament/bracket-generator.ts`          | Single-elimination bracket generation with seeding           |
| MatchManager             | `src/core/tournament/match-manager.ts`              | Match lifecycle (report, forfeit, resolve, advance)          |
| ScoreValidator           | `src/core/tournament/score-validator.ts`            | Pure-function best-of-N score validation                     |
| DeadlineScheduler        | `src/core/tournament/deadline-scheduler.ts`         | Periodic deadline checking (5-min interval)                  |
| TournamentChannelManager | `src/core/tournament/tournament-channel-manager.ts` | Discord channel/thread creation and archiving                |
| TournamentNotifications  | `src/core/tournament/tournament-notifications.ts`   | MC whispers + Discord embeds for match events                |
| BracketVisualizer        | `src/core/tournament/bracket-visualizer.ts`         | PNG bracket image and MC text generation                     |
| AuditLogger              | `src/core/tournament/audit-logger.ts`               | Admin action audit trail in `tournament_audit_log`           |
| AntiAbuse                | `src/core/tournament/anti-abuse.ts`                 | Rate limiting, forfeit pattern detection, alt account checks |

## Database Tables

| Table                  | Description                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `tournaments`          | Core tournament record (name, game, status, rounds, deadlines)    |
| `tournament_players`   | Players per tournament (UUID, Discord ID, seed, status, check-in) |
| `tournament_matches`   | Individual matches (players, scores, status, thread, deadline)    |
| `tournament_reports`   | Score reports submitted by players per match                      |
| `tournament_audit_log` | Admin action audit trail                                          |

## Lifecycle

See `tournament-flowchart.mmd` for the visual flowchart.

Four phases:

1. **Setup & Signups** — Admin creates, players join/leave, check-in window
2. **Bracket Generation** — Admin starts, bracket is auto-generated with seeding
3. **Active Match Lifecycle** — Players play, report scores, deadlines enforced
4. **Progression** — Winners advance, tournament completes or continues

### States

Tournament: `SIGNUP` → `ACTIVE` → `COMPLETED` / `CANCELLED`

Player: `REGISTERED` → `CHECKED_IN` → `ACTIVE` → `ELIMINATED` / `WINNER`

Match: `PENDING` → `ACTIVE` → `REPORTED` / `DISPUTED` → `BOTH_CONFIRMED` → `COMPLETED` / `BYE`

## Setup Guide

### Prerequisites

1. The bot must be in a Discord guild with permissions (Manage Channels, Manage Threads)
2. Tournament must be enabled per-bridge: `/settings tournamentEnabled true`
3. Configure notification channel and defaults via `/settings`

### Discord Channel Setup

1. Create a Discord category for tournaments
2. Right-click the category → Copy ID (Developer Mode must be on)
3. Set it via `/settings tournamentNotificationChannelId <id>`

Or set `tournament.notificationChannelId` in `application-config.yml`.

## Commands

### Discord Slash Commands

| Command                                                            | Permission    | Description                                                    |
| ------------------------------------------------------------------ | ------------- | -------------------------------------------------------------- |
| `/tournament create name: game_type: [best_of:] [deadline_hours:]` | Admin/Officer | Create a new tournament                                        |
| `/tournament join`                                                 | Anyone        | Join the active tournament                                     |
| `/tournament leave`                                                | Anyone        | Leave the active tournament                                    |
| `/tournament start`                                                | Admin/Officer | Start the tournament (generates bracket, channels, threads)    |
| `/tournament cancel`                                               | Admin/Officer | Cancel the tournament and archive threads                      |
| `/tournament status`                                               | Anyone        | View tournament status (phase, round, player count)            |
| `/tournament bracket`                                              | Anyone        | Link to the live bracket Discord channel                       |
| `/tournament report winner:[me/opponent] my_wins: their_wins:`     | Participants  | Report match score                                             |
| `/tournament confirm match_id: winner:`                            | Admin/Officer | Force-resolve a disputed match                                 |
| `/tournament open-checkin`                                         | Admin/Officer | Open check-in window manually                                  |
| `/tournament checkin`                                              | Anyone        | Check in for the tournament                                    |
| `/tournament extend match_id: hours:`                              | Admin/Officer | Extend match deadline                                          |
| `/tournament forfeit`                                              | Participants  | Forfeit your active match                                      |
| `/tournament schedule time:`                                       | Participants  | Post availability in match thread                              |
| `/tournament test [name:] [game_type:] [best_of:] [players:] [deadline_hours:] [bind_user:] [auto_start:]` | Admin/Officer | Create test tournament with fake players and interactive panel |

### Minecraft Chat Commands

Triggers: `!tournament`, `!tour`, `!t`

| Command                                                  | Description                     |
| -------------------------------------------------------- | ------------------------------- |
| `!tournament join`                                       | Join the active tournament      |
| `!tournament checkin`                                    | Check in for the tournament     |
| `!tournament report <me\|opponent> <myWins> <theirWins>` | Report match score              |
| `!tournament forfeit`                                    | Forfeit current match           |
| `!tournament bracket`                                    | Link to Discord bracket channel |
| `!tournament status`                                     | View tournament status summary  |

## Admin Runbook

### Handling Disputes

When both players report conflicting scores, the match becomes **Disputed**. A dispute notification embed is sent to the configured notification channel.

1. Review proof attachments (screenshots, replays) in the match thread
2. Determine the correct winner
3. Run `/tournament confirm match_id:<id> winner:<username>` to force-resolve

### Handling No-Shows

If a player doesn't report before the deadline, the `DeadlineScheduler` auto-resolves:

| Reports submitted | Outcome                               |
| ----------------- | ------------------------------------- |
| None              | Higher seed advances                  |
| One               | The reporting player advances         |
| Both (disputed)   | Match remains disputed; admins pinged |
| Both (agree)      | Winner is resolved normally           |

### Bot Restart Recovery

On restart, `TournamentManager.load()` re-fetches all active tournaments from the database. The `DeadlineScheduler` re-evaluates all deadlines on its next 5-minute tick, including:

- Re-sending 24h warnings
- Re-resolving expired deadlines
- No data is lost (all state is in PostgreSQL)

### Check-in Management

- Default: auto-checkin on join (configurable via `tournamentAutoCheckin`)
- Admin can manually open a check-in window: `/tournament open-checkin`
- Players who don't check in before bracket generation are excluded

### Test Tournament Panel

`/tournament test` creates a tournament with fake players and an interactive control panel:

| Button           | Action                                  |
| ---------------- | --------------------------------------- |
| ▶ Resolve Round  | Resolve all matches in current round    |
| ⏭ Resolve Match | Resolve one match at a time             |
| ⚡ Dispute Match | Simulate a disputed match               |
| ⏮ Rewind Round  | Undo the current round                  |
| ⏮ Rewind All    | Undo all matches                        |
| 🗑 Cleanup       | Delete the test tournament and channels |

## Edge Cases

### Best-of-N Score Validation

Rules enforced by `validateSeriesScore()` in `score-validator.ts`:

- Winner must reach exactly `ceil(bestOf / 2)` wins
- Example: Bo3 requires 2 wins (2-0 or 2-1 valid; 3-0 invalid)
- Wins + losses must not exceed `bestOf`
- Both scores must be non-negative integers
- Winner cannot exceed target wins
- No ties (losing score must be strictly less than target)

### Check-in Requirements

- Default: auto-checkin on join
- Admin can open a check-in window manually
- Players who don't check in are excluded from bracket generation
- Minimum participants required (configurable per-bridge, default 4)
- Reminder whispers sent 1 hour before check-in closes

### Deadline System

- Deadline is set per-round at bracket generation time
- 24-hour warning: MC whisper to both players + Discord embed in match thread
- Deadline expiry auto-resolves (see no-show table above)
- Extensions granted by admin are cumulative but capped at `tournamentMaxExtensionHours`

### Alt Account Detection

`AntiAbuse.checkAltAccounts()` cross-references the `mojang` table for shared IP addresses among tournament participants. Players sharing an IP are flagged.

### Forfeit Abuse Detection

`AntiAbuse` tracks forfeit patterns. If the same pair of players forfeit against each other 3+ times, it flags as suspicious.

## Configuration Reference

### Per-bridge settings (set via `/settings` on Discord)

| Key                               | Default | Description                              |
| --------------------------------- | ------- | ---------------------------------------- |
| `tournamentEnabled`               | false   | Enable tournaments on this bridge        |
| `tournamentNotificationChannelId` | ''      | Discord channel for global announcements |
| `tournamentDefaultDeadlineHours`  | 48      | Default deadline per round               |
| `tournamentDefaultBestOf`         | 1       | Default best-of for matches              |
| `tournamentAnnounceMc`            | true    | Announce in MC guild chat                |
| `tournamentCheckinWindowMinutes`  | 60      | Check-in window duration                 |
| `tournamentMinParticipants`       | 4       | Minimum checked-in players to start      |
| `tournamentMaxExtensionHours`     | 24      | Max cumulative deadline extension        |
| `tournamentAutoCheckin`           | true    | Auto-checkin on join                     |

### File config (`application-config.yml`)

```yaml
tournament:
  notificationChannelId: '123456789012345678'
```
