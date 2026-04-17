import { en } from './resources/en'
import { fr } from './resources/fr'

export const supportedLocales = ['fr', 'en'] as const

export type SupportedLocale = (typeof supportedLocales)[number]

export { en, fr }
