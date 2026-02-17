import { defineConfig } from 'wxt';
import pkg from './package.json';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Fallen London Favourites',
    short_name: 'Fallen London Favourites',
    description:
      'Mark storylets, branches and cards as favourite or avoided in Fallen London. Favourites rise to the top, avoided sink to the bottom.',
    version: pkg.version,
    icons: {
      '16': 'img/icon16.png',
      '32': 'img/icon32.png',
      '48': 'img/icon48.png',
      '128': 'img/icon128.png',
    },
    browser_specific_settings: {
      gecko: {
        id: '{7bb30f84-a0c4-406c-9590-191c5b486891}',
        // @ts-expect-error — new Firefox requirement, WXT types not updated yet
        data_collection_permissions: {
          required: ['none'],
        },
      },
      gecko_android: {
        strict_min_version: '142.0',
      },
    },
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: ['*://*.fallenlondon.com/*'],
    web_accessible_resources: [
      {
        resources: ['img/*'],
        matches: ['*://*.fallenlondon.com/*'],
      },
    ],
  },
});
