declare module 'bad-words' {
  interface BadWordsConstructor {
    new (options?: BadWordsOptions): BadWords

    (options?: BadWordsOptions): BadWords
  }

  declare const constructor: BadWordsConstructor
  export = constructor

  export class BadWords {
    addWords: (...words: string[]) => void
    clean: (text: string) => string
    isProfane: (text: string) => boolean
    removeWords: (...arguments_: string[]) => void
  }

  export interface BadWordsOptions {
    emptyList?: boolean
    list?: string[]
    placeHolder?: string
    regex?: string
    replaceRegex?: string
  }
}
