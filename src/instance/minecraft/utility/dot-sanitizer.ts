export default class DotsSanitizer {
  public process(message: string): string {
    return message.replaceAll(/(?<!\d)\.(?!\d)/g, '')
  }
}
