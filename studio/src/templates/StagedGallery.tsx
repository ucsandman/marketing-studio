import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {useFormat} from '../lib/layout';
import {StagedScene} from '../components/StagedScene';
import {stagedSceneSchema} from '../lib/staged';
import type {StagedConfig} from '../lib/staged';

// Proof composition for the StagedScene system (docs/product-launch-motion-adoption.md
// Phase C). Each construction runs a full act back to back so the beat scaling, the
// camera law and the still tail can be judged from full-resolution stills. The copy
// is deliberately generic placeholder text: a gallery must not carry product claims.

const SHOTS: {label: string; len: number; config: StagedConfig}[] = [
  {
    label: 'results',
    len: 180,
    config: stagedSceneSchema.parse({
      kind: 'results',
      query: 'Search the workspace',
      chips: ['Recent', 'Shared'],
      countLabel: '4 matches',
      rows: [
        {primary: 'Item alpha', secondary: 'Folder one', meta: '12 kb', idleState: 'Pending', state: 'Ready'},
        {primary: 'Item beta', secondary: 'Folder two', meta: '8 kb', idleState: 'Pending', state: 'Ready'},
        {primary: 'Item gamma', secondary: 'Folder three', meta: '21 kb', idleState: 'Pending', state: 'Matched'},
        {primary: 'Item delta', secondary: 'Folder four', meta: '5 kb', idleState: 'Pending', state: 'Ready'},
      ],
      highlightIndex: 2,
      stat: {value: '4', label: 'matches'},
    }),
  },
  {
    label: 'composer',
    len: 180,
    config: stagedSceneSchema.parse({
      kind: 'composer',
      placeholder: 'Ask for anything',
      query: 'Summarize the latest three reports',
      submitLabel: 'Run',
      submittedLabel: 'Running',
      runTitle: 'Run steps',
      steps: [
        {label: 'Collect', meta: '3 s'},
        {label: 'Compare', meta: '2 s'},
        {label: 'Publish', meta: null},
      ],
    }),
  },
  {
    label: 'status',
    len: 150,
    config: stagedSceneSchema.parse({
      kind: 'status',
      subject: {title: 'Batch nine', sub: 'Queued at 09:14', badge: 'B9'},
      states: [
        {label: 'Received', meta: '09:14'},
        {label: 'Checked', meta: '09:15'},
        {label: 'Published', meta: null},
      ],
      counter: {value: '3', label: 'steps done'},
      action: null,
    }),
  },
];

export const StagedGallery: React.FC = () => {
  const brand = getBrand('noban');
  const fonts = loadBrandFonts(brand);
  const {scale, safe} = useFormat();
  let cursor = 0;
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {SHOTS.map((shot, i) => {
        const from = cursor;
        cursor += shot.len;
        return (
          <Sequence key={shot.label} from={from} durationInFrames={shot.len}>
            {/* stands in for LaunchVideo's FeatureAct heading, so the band that
                stageFit reserves above the stage is honest in this proof */}
            <div
              style={{
                position: 'absolute',
                top: Math.max(Math.round(64 * scale), safe.top),
                left: safe.left,
                right: safe.right,
                textAlign: 'center',
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: Math.round(56 * scale),
                color: brand.colors.ink,
              }}
            >
              {shot.label}
            </div>
            <StagedScene config={shot.config} len={shot.len} brand={brand} seat={i} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
