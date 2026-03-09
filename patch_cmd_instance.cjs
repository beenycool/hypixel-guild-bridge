const fs = require('node:fs')

const file = 'src/instance/commands/commands-instance.ts'
let code = fs.readFileSync(file, 'utf8')

if (!code.includes('import Murdermystery from')) {
  code = code.replace(
    `import Mute from './triggers/mute.js'`,
    `import Murdermystery from './triggers/murdermystery.js'\nimport Mute from './triggers/mute.js'`
  )
}

if (!code.includes('new Murdermystery()')) {
  code = code.replace(`new Mute(),`, `new Murdermystery(),\n      new Mute(),`)
}

fs.writeFileSync(file, code)
