import { en, fr } from '@club-erp/i18n'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const supportedLanguages = ['fr', 'en'] as const

type SupportedLanguage = (typeof supportedLanguages)[number]

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.includes(value as SupportedLanguage)
}

function detectInitialLanguage(): SupportedLanguage {
  const localStorageValue = localStorage.getItem('club-erp-language')
  if (localStorageValue && isSupportedLanguage(localStorageValue)) {
    return localStorageValue
  }

  const browserLanguage = navigator.language.split('-')[0]
  if (isSupportedLanguage(browserLanguage)) {
    return browserLanguage
  }

  return 'fr'
}

i18n.use(initReactI18next).init({
  resources: {
    fr: {
      common: fr.common,
      dashboard: fr.dashboard,
      members: fr.members,
      club: fr.club,
      planning: fr.planning,
      helloasso: fr.helloasso,
      planche: fr.planche,
      storage: fr.storage,
      banque: fr.banque,
      admin: fr.admin,
      assets: fr.assets,
      flights: fr.flights,
      vi: fr.vi,
      rh: fr.rh,
      pricing: fr.pricing,
      help: fr.help,
      carburant: fr.carburant,
    },
    en: {
      common: en.common,
      dashboard: en.dashboard,
      members: en.members,
      club: en.club,
      planning: en.planning,
      helloasso: en.helloasso,
      planche: en.planche,
      storage: en.storage,
      banque: en.banque,
      admin: en.admin,
      assets: en.assets,
      flights: en.flights,
      vi: en.vi,
      rh: en.rh,
      pricing: en.pricing,
      help: en.help,
      carburant: en.carburant,
    },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'fr',
  interpolation: {
    escapeValue: false,
  },
  defaultNS: 'common',
  ns: ['common', 'dashboard', 'members', 'club', 'planning', 'helloasso', 'planche', 'storage', 'banque', 'admin', 'assets', 'flights', 'vi', 'rh', 'pricing', 'help', 'carburant'],
})

void i18n.on('languageChanged', (newLanguage) => {
  localStorage.setItem('club-erp-language', newLanguage)
})

export default i18n
