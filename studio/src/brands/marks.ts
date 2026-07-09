import type React from 'react';
import {NobanMark} from './NobanMark';
import {DashClawMark} from './DashClawMark';

export type MarkComponent = React.FC<{size: number; color: string}>;

const registry: Record<string, MarkComponent> = {noban: NobanMark, dashclaw: DashClawMark};

export const getMark = (id: string): MarkComponent => {
  const mark = registry[id];
  if (!mark) {
    throw new Error(`No mark component for brand "${id}". Available: ${Object.keys(registry).join(', ')}`);
  }
  return mark;
};
