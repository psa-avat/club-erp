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
      planche: fr.planche,
      banque: fr.banque,
      admin: fr.admin,
      assets: fr.assets,
    },
    en: {
      common: en.common,
      dashboard: en.dashboard,
      members: en.members,
      club: en.club,
      planning: en.planning,
      planche: en.planche,
      banque: en.banque,
      admin: en.admin,
      assets: en.assets,
    },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'fr',
  interpolation: {
    escapeValue: false,
  },
  defaultNS: 'common',
  ns: ['common', 'dashboard', 'members', 'club', 'planning', 'planche', 'banque', 'admin', 'assets'],
})

void i18n.on('languageChanged', (newLanguage) => {
  localStorage.setItem('club-erp-language', newLanguage)
})

export default i18n
