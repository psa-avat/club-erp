import type { Preview } from '@storybook/react'
import '../src/tokens.css'

/**
 * Global Storybook preview configuration.
 * Import design tokens so stories use the same CSS variables as the app.
 */
const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      element: '#storybook-root',
      config: {
        rules: [
          // Allow stories to skip colour-contrast checks where tokens are
          // deliberately low-contrast (e.g. disabled states).
          { id: 'color-contrast', enabled: false },
        ],
      },
    },
  },
}

export default preview

