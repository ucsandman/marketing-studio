import type React from 'react';
import type {Brand} from '../lib/brand';
import {SynthaconReveal} from './SynthaconReveal';

export type RevealComponent = React.FC<{size: number; brand: Brand; loop?: boolean}>;

// Optional per-brand VECTOR logo reveal — mirrors marks.ts's registry shape, but
// (unlike getMark) returns null instead of throwing: most brands have no vector
// reveal yet and fall back to their Blender PNG sequence / static Mark in
// LogoReveal.tsx.
const registry: Record<string, RevealComponent> = {
  synthacon: SynthaconReveal,
};

export const getReveal = (id: string): RevealComponent | null => registry[id] ?? null;
