declare module 'bad-words' {
  interface BadWordsOptions {
    emptyList?: boolean
    list?: string[]
    placeHolder?: string
    regex?: string
    replaceRegex?: string
  }

  class BadWords {
    constructor(options?: BadWordsOptions)

    addWords: (...words: string[]) => void
    clean: (text: string) => string
    isProfane: (text: string) => boolean
    removeWords: (...arguments_: string[]) => void
  }

  export default BadWords
  export { BadWordsOptions }
}
