import React from 'react';

import { EditorialHomeScreen } from '@/features/editorial/EditorialHomeScreen';
import { SpeakingHomeScreen } from '@/features/speaking/SpeakingHomeScreen';
import { useLearningMode } from '@/context/LearningModeContext';

export default function HomeRoute() {
  const { mode } = useLearningMode();
  return mode === 'speak' ? <SpeakingHomeScreen /> : <EditorialHomeScreen />;
}
