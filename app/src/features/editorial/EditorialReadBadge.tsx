import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { useAppTheme } from '@/context/ThemeContext';

import { isEditorialArticleRead, subscribeEditorialRead } from './editorialReadStorage';

export function EditorialReadBadge({ articleId }: { articleId: string }) {
  const { theme } = useAppTheme();
  const [read, setRead] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let completed = false;
    const unsubscribe = subscribeEditorialRead((id) => {
      if (id === articleId) {
        completed = true;
        setRead(articleId);
      }
    });
    void isEditorialArticleRead(articleId).then((saved) => {
      if (active) setRead(saved || completed ? articleId : null);
    }).catch(() => undefined);
    return () => { active = false; unsubscribe(); };
  }, [articleId]);

  return read === articleId ? (
    <Text style={{ color: theme.accent, backgroundColor: theme.accentSoft, alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 6, fontSize: 12 }}>
      已读
    </Text>
  ) : null;
}
