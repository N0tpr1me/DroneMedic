import type { Meta, StoryObj } from '@storybook/react';
import { DeliveryConfirmation } from '../components/dashboard/DeliveryConfirmation';

const meta: Meta<typeof DeliveryConfirmation> = {
  title: 'Dashboard/DeliveryConfirmation',
  component: DeliveryConfirmation,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof DeliveryConfirmation>;

export const Open: Story = {
  args: {
    open: true,
    onClose: () => {},
    missionId: 'a1b2c3d4e5f6',
    destination: 'Royal London Hospital',
    supply: 'blood_pack',
    onConfirm: (data) => console.log('Confirmed:', data),
  },
};
