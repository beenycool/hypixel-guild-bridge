interface ConfigSchema {
  version: number
}

export class ConfigurationMigrator {
  private readonly migrations = new Map<number, (raw: Map<string, unknown>) => void>()

  register(fromVersion: number, migration: (raw: Map<string, unknown>) => void): void {
    this.migrations.set(fromVersion, migration)
  }

  migrate(raw: Map<string, unknown>): void {
    const versions = [...this.migrations.keys()].sort((a, b) => a - b)

    for (const version of versions) {
      const currentVersion = (raw.get('_version') as number) ?? 0
      if (version >= currentVersion) {
        const migration = this.migrations.get(version)
        if (migration) {
          migration(raw)
          raw.set('_version', version + 1)
        }
      }
    }
  }
}
