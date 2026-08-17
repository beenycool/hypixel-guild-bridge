import type { Items } from 'skyhelper-networth/types/ProfileNetworthCalculator'

declare module 'skyhelper-networth' {
  export class ProfileNetworthCalculator {
    constructor(profileData: object, museumData?: object, bankBalance?: number)

    getNetworth(options?: NetworthOptions): Promise<NetworthResult>

    getNonCosmeticNetworth(options?: NetworthOptions): Promise<NetworthResult>

    fromPreParsed(profileData: object, items: Items, bankBalance: number): ProfileNetworthCalculator
  }
}
