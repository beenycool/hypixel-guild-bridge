const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function isValidTableName(name: string): boolean {
  return VALID_TABLE_NAME.test(name)
}
