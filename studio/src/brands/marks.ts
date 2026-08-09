import type React from 'react';
import {NobanMark} from './NobanMark';
import {DashClawMark} from './DashClawMark';
import {PaperRouteMark} from './PaperRouteMark';
import {MagneticMark} from './MagneticMark';
import {CostClawMark} from './CostClawMark';
import {PhoneClaudeMark} from './PhoneClaudeMark';

export type MarkComponent = React.FC<{size: number; color: string}>;

const registry: Record<string, MarkComponent> = {
  noban: NobanMark,
  dashclaw: DashClawMark,
  paperroute: PaperRouteMark,
  magnetic: MagneticMark,
  costclaw: CostClawMark,
  phoneclaude: PhoneClaudeMark,
};

export const getMark = (id: string): MarkComponent => {
  const mark = registry[id];
  if (!mark) {
    throw new Error(`No mark component for brand "${id}". Available: ${Object.keys(registry).join(', ')}`);
  }
  return mark;
};
