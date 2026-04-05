import type { Preview } from '@storybook/react';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0f1418' },
        { name: 'light', value: '#f8fafc' },
      ],
    },
  },
};

export default preview;
