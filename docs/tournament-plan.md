# Tournament System — Implementation Plan

## Overview

Self-scheduled single-elimination bracket tournament. Members opt in during signup phase. Matches are Bo3 (configurable) of Bridge or BedWars (mutual agreement, defaults to Bridge), played at players' own time. Discord members get private threads; Minecraft-only members get in-game whispers. Live tracker channel gives admins real-time visibility. All matches linked via `next_match_id` for reliable bracket traversal.

---

## 1. Configuration

**Add to `config.yaml`:**

```yaml
tournament:
  categoryId: '123456789' # Discord category for tournament channels
  roundDeadlineDays: 7 # max days per round
  defaultGameMode: 'bridge' # fallback if players can't agree
  bestOf: 3 # matches are BoX (must be odd number)
```

---

## 2. Database — New Migration (`008-tournaments.ts`)

### `tournaments`

| Column        | Type          | Notes                                                            |
| ------------- | ------------- | ---------------------------------------------------------------- |
| id            | SERIAL PK     |                                                                  |
| name          | VARCHAR(255)  | e.g. "Guild Wars #1"                                             |
| best_of       | INT DEFAULT 3 | Best-of-X (must be odd). Win condition = `Math.ceil(bestOf / 2)` |
| status        | VARCHAR(20)   | `signup` / `active` / `completed` / `cancelled`                  |
| channel_id    | VARCHAR(255)  | Discord channel ID                                               |
| message_id    | VARCHAR(255)  | Pinned tracker message ID                                        |
| created_by    | VARCHAR(255)  | Discord ID of admin                                              |
| current_round | INT DEFAULT 0 |                                                                  |
| total_rounds  | INT DEFAULT 0 |                                                                  |
| created_at    | TIMESTAMP     |                                                                  |
| completed_at  | TIMESTAMP     | nullable                                                         |

### `tournament_participants`

| Column         | Type                 | Notes                      |
| -------------- | -------------------- | -------------------------- |
| id             | SERIAL PK            |                            |
| tournament_id  | INT FK → tournaments |                            |
| minecraft_uuid | VARCHAR(36)          | From mojang table          |
| discord_id     | VARCHAR(255)         | Nullable, from links table |
| seed           | INT                  | Random seed for seeding    |
| eliminated     | BOOLEAN              |                            |
| final_rank     | INT                  | nullable                   |
| registered_at  | TIMESTAMP            |                            |

### `tournament_matches`

| Column             | Type                           | Notes                                                                                                 |
| ------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| id                 | SERIAL PK                      |                                                                                                       |
| tournament_id      | INT FK → tournaments           |                                                                                                       |
| round              | INT                            |                                                                                                       |
| match_index        | INT                            | Position in round                                                                                     |
| player1_uuid       | VARCHAR(36)                    | nullable (populated when previous match resolves)                                                     |
| player2_uuid       | VARCHAR(36)                    | nullable (populated when previous match resolves, or bye)                                             |
| winner_uuid        | VARCHAR(36)                    | nullable                                                                                              |
| next_match_id      | INT FK → tournament_matches.id | nullable. Pre-linked to the match the winner feeds into                                               |
| game_mode          | VARCHAR(20)                    | `bridge` / `bedwars` / null                                                                           |
| p1_score           | INT DEFAULT 0                  | Confirmed winner score                                                                                |
| p2_score           | INT DEFAULT 0                  | Confirmed loser score                                                                                 |
| p1_reported_wins   | INT                            | nullable, reported by P1                                                                              |
| p1_reported_losses | INT                            | nullable, reported by P1                                                                              |
| p2_reported_wins   | INT                            | nullable, reported by P2                                                                              |
| p2_reported_losses | INT                            | nullable, reported by P2                                                                              |
| proof_url          | TEXT                           | nullable. Admins can attach screenshot evidence for disputes                                          |
| status             | VARCHAR(20)                    | `pending` / `player_filled` / `p1_reported` / `both_confirmed` / `completed` / `disputed` / `expired` |
| thread_id          | VARCHAR(255)                   | nullable, Discord thread ID                                                                           |
| deadline           | TIMESTAMP                      | created_at + roundDeadlineDays                                                                        |
| created_at         | TIMESTAMP                      |                                                                                                       |
| completed_at       | TIMESTAMP                      | nullable                                                                                              |

---

## 3. Bracket Generation — All Matches Created Upfront

When the bracket is generated, **every match for every round** is created immediately:

1. Determine total rounds from participant count
2. For each round, create the required number of match rows (with null players for rounds beyond R1)
3. Set `next_match_id` on each match to point to the next-round slot
4. As matches resolve, the bot pushes the winner UUID into the appropriate `player1_uuid` or `player2_uuid` slot of the `next_match_id` match
5. When both players of a future-round match are filled, create its thread + send whispers

This avoids fragile round-index math and handles byes, substitutes, and admin interventions cleanly.

---

## 4. New Files

### `src/types/tournament.ts`

TypeScript interfaces: `Tournament`, `TournamentParticipant`, `TournamentMatch`, `TournamentStatus`.

### `src/instance/tournament/tournament-manager.ts`

Core singleton with all tournament logic. Methods:

| Method                                                | Description                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `create(name, creatorDiscordId)`                      | Create tournament, status=signup                                                                                   |
| `join(tournamentId, discordId)`                       | Opt in during signup phase                                                                                         |
| `leave(tournamentId, discordId)`                      | Drop out before bracket locks                                                                                      |
| `lockSignupsAndEnrollOptIns(tournamentId)`            | Fetch UUIDs/Discord IDs for opted-in members only, insert participants                                             |
| `generateBracket(tournamentId)`                       | Random seeding, single-elimination, create ALL match rows upfront with `next_match_id` linking                     |
| `createChannel(tournamentId)`                         | Create Discord channel under configured category                                                                   |
| `createMatchThread(matchId)`                          | Create private thread (type 12) — addMember for both players + all Officer+ members                                |
| `batchCreateThreads(matchIds)`                        | Create threads in batches of 5 with 1s delay between batches                                                       |
| `archiveThread(threadId)`                             | Lock + archive a thread when its match resolves                                                                    |
| `sendMinecraftWhisper(uuid, message)`                 | Bot's MC account whispers the player                                                                               |
| `reportScore(matchId, uuidOrDiscordId, wins, losses)` | Validate (wins+losses ≤ bestOf), store, check match or dispute. Allows overwriting own report until both_confirmed |
| `confirmMatch(matchId, adminDiscordId)`               | Force-advance winner (for disputed matches)                                                                        |
| `resolveConfirmedMatch(matchId)`                      | Auto-advance winner when both reports match. Push winner into `next_match_id` slot                                 |
| `substitutePlayer(matchId, oldUuid, newUuid)`         | Admin hot-swap a participant mid-tournament                                                                        |
| `modReport(matchId, playerUuid, wins, losses)`        | Admin force-reports a score on behalf of a player                                                                  |
| `checkDeadlines()`                                    | Periodic check for expired matches + 24h warnings                                                                  |
| `getBracketData(tournamentId)`                        | Structured bracket data for visualization                                                                          |
| `getTrackerEmbed(tournamentId)`                       | Build live tracker embed                                                                                           |
| `forfeit(matchId, uuidOrDiscordId)`                   | Concede match                                                                                                      |
| `getMemberMatch(tournamentId, uuidOrDiscordId)`       | Find current match for a player                                                                                    |
| `getStatus(tournamentId)`                             | Tournament stats                                                                                                   |

### `src/instance/tournament/bracket-visualizer.ts`

- `buildBracketImage(bracketData)` → Generate PNG bracket image via `canvas` or `skia-canvas`
- `buildBracketEmbed(bracketData)` → Discord embed with image attachment
- `buildMcBracketSummary(bracketData)` → Text summary for Minecraft: current round, matches remaining, Discord link

### `src/instance/discord/commands/tournament.ts`

Discord slash command `/tournament` with subcommands.

### `src/instance/commands/triggers/tournament.ts`

Minecraft chat command `!tournament` / `!tourney`.

---

## 5. Files to Modify

### `src/instance/commands/commands-instance.ts`

Register `TournamentMCCommand`.

### `src/instance/discord/command-manager.ts`

Import + register `TournamentCommand`.

### `src/application-config.ts`

Add `tournamentCategoryId` to config types/parsing.

### `package.json`

Add `canvas` or `skia-canvas` dependency for bracket image generation.

---

## 6. Commands

### Discord (`/tournament`)

| Subcommand                                  | Permission | Description                                                                          |
| ------------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `create name:`                              | Admin      | Create tournament, open signups                                                      |
| `start`                                     | Admin      | Lock signups, generate bracket from opted-in members, create channel + threads       |
| `join`                                      | Anyone     | Join the active tournament during signup                                             |
| `leave`                                     | Anyone     | Leave before bracket locks                                                           |
| `status`                                    | Anyone     | Your current match info                                                              |
| `bracket`                                   | Anyone     | Full bracket as generated PNG image                                                  |
| `report score:`                             | Anyone     | Report match result (e.g. `2-0`). Can re-report to overwrite until opponent confirms |
| `schedule time:`                            | Anyone     | Specify availability in your match thread (converts to Discord timestamp)            |
| `forfeit`                                   | Anyone     | Concede your match                                                                   |
| `confirm match:`                            | Admin      | Force-resolve a disputed match & advance winner                                      |
| `substitute match: old-player: new-player:` | Admin      | Hot-swap a participant mid-tournament                                                |
| `mod-report match: player: score:`          | Admin      | Force a score report on behalf of a player                                           |
| `cancel`                                    | Admin      | Cancel tournament                                                                    |

### Minecraft (`!tournament`)

| Args                     | Permission | Description                                                                   |
| ------------------------ | ---------- | ----------------------------------------------------------------------------- |
| _(none)_                 | Anyone     | Show your current match                                                       |
| `report <wins>-<losses>` | Anyone     | Report score (e.g. `!tournament report 2-1`). Validated: wins+losses ≤ bestOf |
| `bracket`                | Anyone     | "Round 3 — 4 matches remaining. View full bracket in Discord"                 |
| `forfeit`                | Anyone     | Forfeit your match                                                            |

---

## 7. Lifecycle

```
CREATE (signup) → JOIN → START (active) → PLAY → REPORT → RESOLVE → next round → DONE
```

### On Create (`/tournament create name:"Guild Wars #1"`)

- DB: tournaments row (status=signup, best_of=3)
- Reply: "Tournament created! Members can join with /tournament join"

### While Signup is Open

- Members run `/tournament join` → added to participants (discord_id set)
- Members run `/tournament leave` → removed from participants

### On Start (`/tournament start`)

- Lock signups — no more joins allowed
- For each opted-in member, fetch their Minecraft UUID from the `mojang` table (via existing Discord→UUID link)
- Only enrolled members get bracketed. No auto-enrollment of entire guild.
- If fewer than 2 members joined → reply error: "Need at least 2 participants"
- Generate random-seeded single-elimination bracket:
  - Create ALL match rows for all rounds upfront
  - Link them via `next_match_id`
  - Player slots for rounds beyond R1 are null
- Create `#guild-wars-1` channel under configured category:
  - Type: `GUILD_TEXT`
  - Permission overwrites: deny `@everyone` view, allow participants + Officer+ roles to view
  - This channel is read-only for participants (only bot posts)
- Post pinned live tracker embed with ping: `@here Tournament started! Check /tournament status`
- For each Round 1 match, **batch-create Private Threads (type 12) in groups of 5 with 1s delay** to avoid rate limits
  - Thread name: `r1-p1-vs-p2`
  - Use `thread.members.add()` for both players and each Officer+ member
  - Only added users can see the thread (Private Thread behavior)

| Scenario           | Action                                                |
| ------------------ | ----------------------------------------------------- |
| Both on Discord    | Private thread with both + staff                      |
| One on Discord     | Thread with Discord player + staff; whisper MC player |
| Neither on Discord | Whisper both MC players                               |

Whisper format:

```
[Tournament] Round 1 match: You vs Steve. Bo3 Bridge or BedWars.
Party them: /p Steve
Report score: !tournament report <wins>-<losses> (e.g. !tournament report 2-0)
Deadline: July 10
```

### Match Thread Content

```
@Player1 vs @Player2 — Round 1
━━━━━━━━━━━━━━━━━━━━━━━
🎮 Best of 3 — Bridge or BedWars
⏰ Deadline: <t:1234567890:R>

📋 Commands:
  /tournament report score:2-0  — Report your score
  /tournament schedule time:Saturday 14:00-18:00 GMT  — Share availability
  /tournament forfeit           — Concede

Need help? Ping @Staff
```

### On Report

Score format: `wins-losses` (e.g. `2-0`, `2-1`, `0-2`, `1-2`). **Validated:** `wins + losses ≤ tournament.bestOf` and `wins ≠ losses`. Invalid scores rejected.

- First player reports → store their `p*_reported_wins`/`p*_reported_losses`, status = `p1_reported`
  - If that player had previously reported (overwrite), update in place. No status change unless it un-disputes.
- Second player reports:
  - **Scores match** → status = `both_confirmed`. Auto-resolve:
    - Winner (first to `Math.ceil(bestOf/2)` wins) advances
    - Push winner UUID into `next_match_id` match's player slot
    - If `next_match_id` now has both players filled → create its thread + send whispers
    - Loser eliminated
    - Thread updated: "✅ Match resolved! Winner advances."
    - Thread locked + archived
    - Live tracker updated
  - **Scores don't match** → status = `disputed`. Thread updated: "⚠️ Scores don't match! Admin will review." Ping staff.

### On Confirm (`/tournament confirm match:42`)

Admin-only. Used to force-resolve a `disputed` match:

- Prompts admin for winner
- Winner advances via `next_match_id` push
- Thread locked + archived

### On Tournament Complete

- Status = `completed`
- Announce champion in channel
- Post final bracket image + standings

---

## 8. Deadline Enforcement & Reminders

Periodic check (every hour):

| Check           | Match State                                    | Action                                                                                |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| **24h warning** | 24 hours until deadline, no reports            | Post in thread + whisper: "⚠️ 24 hours remaining! Higher seed advances if no report." |
| **Expiry**      | Past deadline, no reports                      | Higher seed auto-advances via `next_match_id`                                         |
| **Expiry**      | Past deadline, one player reported             | Reporter advances automatically                                                       |
| **Expiry**      | Past deadline, both_confirmed not yet resolved | Auto-resolve immediately (winner already determined)                                  |
| **Expiry**      | Past deadline, disputed                        | Ping admin: "Disputed match past deadline — needs admin review."                      |

---

## 9. Game Mode Rules

Players must mutually agree on Bridge or BedWars in their match thread.

- If they can't agree → defaults to Bridge (configured by `defaultGameMode`)
- Tournament can also be configured as single-mode only at create time
- Players should post their decision in the thread so it's documented

---

## 10. Live Tracker (Admin View)

Pinned embed in tournament channel, updated on every match event:

```
🏆 Guild Wars #1 — Active (Bo3)
╔════════════════════════════╗
║ Round 1/5  •  12/48 done   ║
║ Deadline: July 10, 6pm UTC ║
╚════════════════════════════╝

── Round 1 ──
✅ Alex vs Bob      2-0  → Alex
⏳ Charlie vs Dave        (expires Jul 8)
⏳ Eve vs Frank           (expires Jul 9)
⚠️ Greg vs Hank    1-0   (disputed)

── Round 2 (locked) ──
⏳ Alex vs TBD
```

Channel creation post:

```
@here 🏆 Guild Wars #1 has started!
Check your match: /tournament status
View bracket: /tournament bracket
Report score: /tournament report score:2-0

Need help? Ping @Staff
```

---

## 11. Bracket Visualization

### Discord

Instead of text-only embeds (which hit 4096-char limit on large brackets), generate a **PNG image** using `canvas` or `skia-canvas`:

- Clean bracket tree layout with round labels
- Player names, scores, winner highlights
- Matches yet to be played shown with `?` placeholders
- Image attached to Discord embed

### Minecraft

`!tournament bracket` outputs a **summary only** — not ASCII art:

```
🏆 Guild Wars #1 — Round 3
Matches remaining: 4
View full bracket in Discord: [channel invite/link]
```

---

## 12. Scheduling Helper (`/tournament schedule`)

Players in a match thread can post availability:

```
/tournament schedule time:Saturday 14:00-18:00 GMT
```

Bot converts to Discord timestamp: `<t:1688824800:F>` which displays in each viewer's local timezone.

Multiple schedules accumulate in thread for easy coordination.

---

## 13. Discord API Considerations

- **Private Threads (type 12)**: Use `GUILD_PRIVATE_THREAD` — only users explicitly added via `thread.members.add()` can see or participate. No complex permission overwrite management needed per thread.
- **Rate limits**: Threads created in batches of 5, with 1s delay between batches. Channel created before any threads.
- **Auto-archiving**: When a match reaches `completed` status, bot calls `thread.setLocked(true)` + `thread.setArchived(true)` to keep the sidebar clean.
- **Staff discovery**: Officers+ identified via the existing `Permission` system — bot fetches guild members with Officer/Owner/Admin roles.
- **Image generation**: `canvas` package used for bracket rendering. Falls back to a simpler embed if the package isn't available.

---

## 14. Score Validation & Report Overwrites

### Validation rules (applied to both Discord and MC reports):

```
wins + losses ≤ tournament.bestOf
wins ≠ losses
wins ≥ 0, losses ≥ 0
```

Invalid scores rejected with a clear error message.

### Report overwrites

Players can re-run `/tournament report` (or `!tournament report`) to overwrite their own submission:

- Before opponent reports: silently overwrites stored values
- After opponent reports (status = `both_confirmed`): too late, match already resolved
- During dispute: re-reporting can resolve the dispute if scores now match

---

## 15. Edge Cases

| Case                                        | Resolution                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Uneven players                              | Random bye (match created with single player, auto-advances to `next_match_id`) |
| Player leaves guild mid-tournament          | Admin uses `/tournament substitute` to replace them                             |
| Both no-show (deadline)                     | Higher seed auto-advances via `next_match_id`                                   |
| Score dispute (reports don't match)         | Status = `disputed`, admin pings, `/tournament confirm` to force-resolve        |
| Game mode disagreement                      | Defaults to Bridge                                                              |
| All MC-only match                           | Both whispered; report via `!tournament`; bot suggests `/p` to party up         |
| Bot restart mid-tournament                  | State in DB, deadlines rechecked on boot, all threads persisted                 |
| Missing category config                     | `/tournament create` tells admin to configure it                                |
| Fewer than 2 join                           | `/tournament start` fails with clear error                                      |
| Impossible score reported                   | Rejected by validation: wins+losses must not exceed bestOf                      |
| Player wants to re-report                   | Allowed to overwrite own report until both_confirmed                            |
| Future-round match neither player known yet | Match row exists with null players, thread not created until both slots filled  |

---

## 16. Post-Deploy Setup

1. Create a Discord category (e.g. "Tournaments")
2. Right-click category → Copy ID
3. Add to `config.yaml`: `tournament.categoryId: "123456789"`
4. Restart bot
