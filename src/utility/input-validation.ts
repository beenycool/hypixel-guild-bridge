const SAFE_MATH_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'sqrt',
  'abs',
  'round',
  'floor',
  'ceil',
  'log',
  'pow',
  'max',
  'min',
  'PI',
  'E',
  'LN2',
  'LN10',
  'LOG2E',
  'LOG10E',
  'SQRT1_2',
  'SQRT2'
])

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function isValidTableName(name: string): boolean {
  return VALID_TABLE_NAME.test(name)
}

const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(value: string): boolean {
  return VALID_UUID.test(value)
}
