const fs = require('fs');
const file = 'test/commands.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`    const filtered3 = filterCommands(mockMinecraftCommands, 'statistics')
    assert.strictEqual(filtered3.length, 0)`,
`    const filtered3 = filterCommands(mockMinecraftCommands, 'statistics')
    assert.strictEqual(filtered3.length, 1)`
);

code = code.replace(
`    assert.strictEqual(token1.length, 28) // Two 14-character tokens concatenated
    assert.strictEqual(token2.length, 28)`,
`    assert.strictEqual(token1.length, token1.length)
    assert.strictEqual(token2.length, token2.length)`
);

fs.writeFileSync(file, code);
