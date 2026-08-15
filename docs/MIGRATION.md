# Migration

- [Migrate from 3.x to 4.x](#migrate-from-3x-to-4x)
- [Migrate from 2.x to 3.x](#migrate-from-2x-to-3x)

## Migrate from 3.x to 4.x

### config.yaml

It is advised to start with a clean `config.yaml` file by copying `config_example.yaml` and saving the old file
somewhere else.
Most notable changes:

- Add `version: 2`
- Move `discord.adminId` to `discord.adminIds` and make it into a list
- Elements of `discord.adminIds` must be **strings** (quote them); numeric values will be coerced to strings at runtime
- Remove all options in `discord` section except `key` and `adminIds`
- Remove `profanity`, `commands`, `minecraft`, `loggers` sections since they have been moved out to application-managed
  runtime configuration stored in the internal database and controlled by the application via discord command `/settings`
- Remove `socket` section entirely since the feature has been completely removed.
- Remove `useIngameCommand` and `interval` in `metrics` section.

### Application Configurations

Application now has a discord slash command `/settings` that controls most of the application configurations.
This includes discord channels and roles, log channels, minecraft instances, and many other features and components.

Old configuration are NOT auto migrated to the new format.
Make sure to check the new settings and apply back all your old configurations.

### Internal Configurations

Runtime-managed configuration is stored in the application database. The `./config/` directory is still used for local runtime files and backups.

- You should back up `config.yaml` and your PostgreSQL database. The `./config/` directory is only needed for local runtime files and backups.
- New installs must configure `database.url` or `DATABASE_URL` before runtime-managed state can be saved. SQLite is no longer supported; all data must be in PostgreSQL.
- If you change something, make sure all changes are **valid and will not break** the application in any unintentional.
- You can safely delete any file there to reset a part of the application.

## v5.x — Tournament Feature Setup

The tournament feature requires an optional `tournament:` block in your `application-config.yml`:

```yaml
tournament:
  categoryId: '123456789012345678' # Discord category ID for tournament channels
  roundDeadlineDays: 3 # Default deadline per round (≥ 1)
  defaultGameMode: 'bridge' # "bridge" or "bedwars"
  bestOf: 3 # Must be odd, ≥ 1
  staffRoleIds: # Optional: override staff roles
    - '987654321098765432'
  reminderHours: # Optional: override reminder schedule
    - 48
    - 24
    - 6
```

To get the Discord category ID, right-click the category → Copy ID (Developer Mode must be enabled).

The tournament feature must also be enabled per-bridge via `/settings tournamentEnabled true`.
