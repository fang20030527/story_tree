import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { EditorialOverviewScreen } from '@/features/editorial/EditorialOverviewScreen';

export default function EditorialOverviewRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const articleId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <EditorialOverviewScreen articleId={articleId ?? ''} />;
}
