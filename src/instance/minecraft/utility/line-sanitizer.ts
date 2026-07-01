export default class LineSanitizer {
  public process(message: string): string {
    return message.replaceAll(/\s*\n\s*/g, ' ').trim()
  }
}
