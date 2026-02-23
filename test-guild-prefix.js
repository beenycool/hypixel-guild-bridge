// Test script to preview Discord message rendering
// Run with: node test-guild-prefix.js

function escapeMarkdown(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/`/g, '\\`')
}

function testRender(username, rank, message) {
  const fullMessage = `${rank} ${username}: ${message}`
  const withGuildPrefix = `Guild > ${fullMessage}`

  // Simulate the new logic (after my change)
  const withoutPrefix = withGuildPrefix.replace(/^-+/g, '')
  const clickableUsername = `[${username}](https://sky.shiiyu.moe/stats/${username})`
  const newMessage = escapeMarkdown(withoutPrefix).replaceAll(escapeMarkdown(username), clickableUsername)

  console.log('\n' + '='.repeat(60))
  console.log('Original Minecraft Message:')
  console.log(withGuildPrefix)
  console.log('\nDiscord Embed Description (new):')
  console.log(newMessage)
  console.log('\nPreview in Discord:')
  console.log('**Guild >** ' + rank + ' **' + username + '**: ' + message)
}

console.log('Testing Discord Message Rendering')
console.log('==================================')

testRender('r4kz', '[MVP+]', 'Hello everyone!')
testRender('r4kz', '[MVP+]', 'How is everyone doing today?')
testRender('Steve', '[VIP]', 'Anyone want to play bedwars?')

console.log('\n\nNote: Discord embeds will show:')
console.log('- Bold "Guild >" prefix')
console.log('- Rank in plain text (e.g., [MVP+])')
console.log('- Username as clickable link')
console.log('- Left border color based on event type')
console.log('- No green text (Discord limitation)')
