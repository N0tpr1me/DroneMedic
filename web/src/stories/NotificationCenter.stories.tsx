import type { Meta, StoryObj } from '@storybook/react';
import { NotificationCenter } from '../components/dashboard/NotificationCenter';

const meta: Meta<typeof NotificationCenter> = {
  title: 'Dashboard/NotificationCenter',
  component: NotificationCenter,
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof NotificationCenter>;

export const Default: Story = {};
