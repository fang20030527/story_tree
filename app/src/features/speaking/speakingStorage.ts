import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadAuthUser } from '@/features/auth/authStorage';
import { emptySpeakingStore, SpeakingStoreSchema, type SpeakingStore } from './model';

let writes: Promise<unknown> = Promise.resolve();
export async function speakingStorageKey() {
  const user = await loadAuthUser();
  return `speaking:v1:${user?.userId ?? 'guest'}`;
}
async function read(key: string): Promise<SpeakingStore> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? SpeakingStoreSchema.parse(JSON.parse(raw)) : emptySpeakingStore();
}
export async function loadSpeakingStore(key?: string) {
  const scope = key ?? await speakingStorageKey();
  await writes;
  return read(scope);
}
export function updateSpeakingStore(update: (store: SpeakingStore) => void, key?: string): Promise<SpeakingStore> {
  const scope = key ? Promise.resolve(key) : speakingStorageKey();
  const save = writes.then(async () => {
    const resolvedKey = await scope;
    const store = await read(resolvedKey);
    update(store);
    const validated = SpeakingStoreSchema.parse(store);
    await AsyncStorage.setItem(resolvedKey, JSON.stringify(validated));
    return validated;
  });
  writes = save.catch(() => undefined);
  return save;
}
