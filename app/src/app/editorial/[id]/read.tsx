import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { EditorialReadScreen } from '@/features/editorial/EditorialReadScreen';

export default function EditorialReadRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const articleId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <EditorialReadScreen articleId={articleId ?? ''} />;
}
