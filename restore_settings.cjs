const { exec } = require('node:child_process')
const fs = require('node:fs')

const backup = JSON.parse(fs.readFileSync('appsettings_backup.json', 'utf8'))
const settings = {}

for (const item of backup) {
  // Skip slot settings if not needed, but usually we want them.
  // Skip system managed settings if any?
  if (item.name === 'WEBSITE_HTTPLOGGING_RETENTION_DAYS') continue // Optional
  settings[item.name] = item.value
}

// Construct the arguments
const arguments_ = Object.entries(settings).map(([key, value]) => {
  // Escape quotes if necessary, but exec handles some.
  // Safest is to write to a json file and use --settings @file.json
  return `"${key}=${value}"` // This might be tricky with complex values like CONFIG_B64
})

// Better approach: Write a new JSON file for import
const newSettings = {}
for (const item of backup) {
  newSettings[item.name] = item.value
}

fs.writeFileSync('appsettings_restore.json', JSON.stringify(newSettings, null, 2))
console.log('Created appsettings_restore.json')
