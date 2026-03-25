const fs = require('node:fs')

const file = 'src/application-config.ts'
let code = fs.readFileSync(file, 'utf8')

code = code.replaceAll('Record<string, string[]>', '{ [key: string]: string[] }')

fs.writeFileSync(file, code)
