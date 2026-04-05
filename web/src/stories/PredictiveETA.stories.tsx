import type { Meta, StoryObj } from '@storybook/react';
import { PredictiveETA } from '../components/dashboard/PredictiveETA';

const meta: Meta<typeof PredictiveETA> = {
  title: 'Dashboard/PredictiveETA',
  component: PredictiveETA,
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof PredictiveETA>;

export const FarAway: Story = {
  args: { currentSpeed: 15, remainingDistance: 8400, totalDistance: 16800, missionProgress: 50, deliveryStops: 2, nextWaypoint: 'Royal London' },
};
export const Approaching: Story = {
  args: { currentSpeed: 15, remainingDistance: 2000, totalDistance: 16800, missionProgress: 88, deliveryStops: 0, nextWaypoint: 'Depot' },
};
export const Arriving: Story = {
  args: { currentSpeed: 8, remainingDistance: 200, totalDistance: 16800, missionProgress: 99, deliveryStops: 0, nextWaypoint: 'Royal London' },
};
export const Stationary: Story = {
  args: { currentSpeed: 0, remainingDistance: 5000, totalDistance: 16800, missionProgress: 70, deliveryStops: 1, nextWaypoint: 'Homerton' },
};
