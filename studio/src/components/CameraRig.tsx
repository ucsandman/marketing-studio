import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {CameraState, Viewport} from '../lib/camera';

// Two-node camera rig (docs/product-launch-motion-adoption.md, Phase C). A
// whole-shot rotation and a mid-shot scale must live on DIFFERENT elements —
// on one element they fight over a single transform matrix and the move
// judders. Outer node = dolly (scale about a fixed origin, typically the exact
// control being pushed toward, so that point stays put while everything grows
// around it). Inner node = 3D turn (perspective + rotate) with preserve-3d so
// children's static translateZ reads as depth under the turn. Ground layers
// (washes, loops) belong OUTSIDE the rig; everything the camera should move —
// including any cursor — must be a child.
export type CameraTurn = {
  fromY: number; // deg; start around -6..-10
  toY: number; // deg; end -1..-2, never exactly 0 (keeps depth at rest)
  fromX?: number; // deg; small — vertical tilt reads as a mistake fast
  toX?: number;
  perspective?: number; // px; 2200 wide-lens .. 2800 flat
  origin?: string;
  len: number; // frames the turn spans (usually the whole shot)
};

export type DollyMove = {at: number; dur: number; to: number}; // frames, frames, scale

const DOLLY_EASE = Easing.inOut(Easing.cubic);
const TURN_EASE = Easing.inOut(Easing.quad);

const dollyScale = (frame: number, moves: DollyMove[]): number => {
  let scale = 1;
  for (const m of moves) {
    if (frame <= m.at) break;
    scale = interpolate(frame, [m.at, m.at + m.dur], [scale, m.to], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: DOLLY_EASE,
    });
  }
  return scale;
};

export const CameraRig: React.FC<{
  camera?: CameraState | null;
  cameraViewport?: Viewport;
  turn?: CameraTurn | null;
  // Dolly origin as a CSS percentage pair — compute it from the pushed-toward
  // control's center: (targetX / stageWidth, targetY / stageHeight). Before
  // picking a scale, check the push against layout bands on all four edges:
  // edge_after = edge + (edge - origin) * (scale - 1).
  dollyOrigin?: string;
  dolly?: DollyMove[];
  children: React.ReactNode;
}> = ({camera = null, cameraViewport = {width: 1600, height: 900}, turn = null, dollyOrigin = '50% 50%', dolly = [], children}) => {
  const frame = useCurrentFrame();
  const scale = dollyScale(frame, dolly);
  const turnTransform = turn
    ? (() => {
        const p = interpolate(frame, [0, turn.len], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: TURN_EASE,
        });
        const ry = turn.fromY + (turn.toY - turn.fromY) * p;
        const rx = (turn.fromX ?? 0) + ((turn.toX ?? 0) - (turn.fromX ?? 0)) * p;
        return `perspective(${turn.perspective ?? 2600}px) rotateY(${ry}deg) rotateX(${rx}deg)`;
      })()
    : '';
  const rig = (
    <AbsoluteFill
      style={{
        transform: scale === 1 ? undefined : `scale(${scale})`,
        transformOrigin: dollyOrigin,
      }}
    >
      <AbsoluteFill
        style={{
          transform: turnTransform || undefined,
          transformOrigin: turn?.origin ?? '50% 52%',
          transformStyle: 'preserve-3d',
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
  if (!camera) return rig;
  const tx = cameraViewport.width / 2 - camera.originX;
  const ty = cameraViewport.height / 2 - camera.originY;
  return (
    <AbsoluteFill style={{transform: `scale(${camera.scale}) translate(${tx}px, ${ty}px)`}}>
      {rig}
    </AbsoluteFill>
  );
};
