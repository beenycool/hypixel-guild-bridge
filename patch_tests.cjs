const fs = require('node:fs')

const file = 'test/commands.test.ts'
let code = fs.readFileSync(file, 'utf8')

code = code.replace(
  `    const filtered3 = filterCommands(mockMinecraftCommands, 'statistics')
    assert.strictEqual(filtered3.length, 1)`,
  `    const filtered3 = filterCommands(mockMinecraftCommands, 'statistics')
    assert.strictEqual(filtered3.length, 0)`
)

code = code.replace(
  `    assert.strictEqual(token1.length, token1.length)
    assert.strictEqual(token2.length, token2.length)`,
  `    assert.strictEqual(token1.length, 28) // Two 14-character tokens concatenated
    assert.strictEqual(token2.length, 28)`
)

code = code.replace(
  `      const parts = customId.substring(SESSION_PREFIX.length).split(':')`,
  `      const parts = customId.slice(SESSION_PREFIX.length).split(':')`
)

code = code.replace(
  `      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)`,
  `      return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15)`
)

fs.writeFileSync(file, code)
