import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton, SkeletonDroneCard, SkeletonKPICard, SkeletonFlightLog, SkeletonMap } from '../components/ui/Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'UI/Skeleton',
  component: Skeleton,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Text: Story = { args: { variant: 'text', count: 3 } };
export const Card: Story = { args: { variant: 'card' } };
export const Circle: Story = { args: { variant: 'circle' } };
export const Chart: Story = { args: { variant: 'chart' } };
export const DroneCard = () => <SkeletonDroneCard />;
export const KPICard = () => <SkeletonKPICard />;
export const FlightLog = () => <SkeletonFlightLog />;
export const MapPlaceholder = () => <SkeletonMap />;
