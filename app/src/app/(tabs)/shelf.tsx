import React from 'react';

import { ShelfScreen } from '@/features/shelf/ShelfScreen';
import { SpeakingFilesScreen } from '@/features/speaking/SpeakingFilesScreen';
import { useLearningMode } from '@/context/LearningModeContext';

export default function ShelfRoute() {
  const { mode } = useLearningMode();
  return mode === 'speak' ? <SpeakingFilesScreen /> : <ShelfScreen />;
}
