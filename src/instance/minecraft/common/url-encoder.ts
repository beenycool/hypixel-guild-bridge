export function stufDecode(message: string): string {
  if (!message.includes('l$')) return message
  return message
    .split(' ')
    .map((part) => {
      try {
        if (part.startsWith('l$')) return decode(part)
      } catch {
        // Ignore decoding errors
      }

      return part
    })
    .join(' ')
}

function decode(string: string): string {
  if (!string.startsWith('l$')) {
    throw new Error('String does not appear to be in STuF')
  }
  const prefix = string[2]
  const suffix = string[3]
  // eslint-disable-next-line unicorn/prefer-spread
  const dotIndices = string.slice(4, string.indexOf('|')).split('').map(Number)
  const urlBody = string.slice(string.indexOf('|') + 1)

  const first9 = urlBody.slice(0, 9 - dotIndices.length)
  const then = urlBody.slice(9 - dotIndices.length).replaceAll('^', '.')

  let url = first9 + then
  url = charInc(url, -1)

  for (const index of dotIndices) {
    url = url.slice(0, index) + '.' + url.slice(index)
  }

  if (prefix === 'h') {
    url = 'http://' + url
  } else if (prefix === 'H') {
    url = 'https://' + url
  }

  switch (suffix) {
    case '1': {
      url += '.png'

      break
    }
    case '2': {
      url += '.jpg'

      break
    }
    case '3': {
      url += '.jpeg'

      break
    }
    case '4': {
      url += '.gif'

      break
    }
  }

  return url
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function charInc(string_: string, int: number) {
  const charSet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let incrementedString = ''
  for (const char of string_) {
    const index = charSet.indexOf(char)

    if (index == -1) {
      incrementedString += char
    } else {
      let offset = index + int
      while (offset >= charSet.length) {
        offset -= charSet.length
      }
      while (offset < 0) {
        offset += charSet.length
      }
      const nextChar = charSet[offset]
      incrementedString += nextChar
    }
  }
  return incrementedString
}
