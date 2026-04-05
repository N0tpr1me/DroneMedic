import type { Meta, StoryObj } from '@storybook/react';
import { PayloadMonitor } from '../components/dashboard/PayloadMonitor';

const meta: Meta<typeof PayloadMonitor> = {
  title: 'Dashboard/PayloadMonitor',
  component: PayloadMonitor,
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof PayloadMonitor>;

export const Nominal: Story = {
  args: { payloadType: 'blood_pack', temperature: 4.0, integrity: 'nominal', timeRemaining: 252 },
};
export const Warning: Story = {
  args: { payloadType: 'insulin', temperature: 6.8, integrity: 'warning', timeRemaining: 120 },
};
export const Critical: Story = {
  args: { payloadType: 'vaccine_kit', temperature: 9.2, integrity: 'critical', timeRemaining: 15 },
};
