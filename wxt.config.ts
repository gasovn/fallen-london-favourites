import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Fallen London Favourites',
    short_name: 'Fallen London Favourites',
    description:
      'Mark branches, storylets and cards as favourite or avoided in Fallen London. Reorder and protect choices',
    version: '0.6.0',
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
