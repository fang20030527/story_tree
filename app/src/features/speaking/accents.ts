import type { SpeakingMaterial } from './model';
import { speakingSeriesAccent } from './series';

/** 按素材中的实际发音标注；电影可包含多种口音，不按演员国籍推断。 */
const accents: Readonly<Record<string, string>> = {
  'steve-jobs-stanford-2005': '美式',
  'tim-cook-stanford-2019': '美式',
  'jk-rowling-harvard-2008': '英式',
  'jensen-huang-caltech': '美式',
  'denzel-washington-penn-2011': '美式',
  'trump-inauguration-2017': '美式',
  'trump-west-point': '美式',
  'forrest-gump-1994': '美式（美国南部）',
  'titanic-1997': '美式 / 英式',
  'the-odyssey-local': '美式为主',
  'fight-club-1999': '美式',
  'inside-out-2015': '美式',
  'the-godfather-1972': '美式为主',
  'the-shawshank-redemption-1994': '美式',
  'zootopia-2-2025': '美式为主',
};

export function speakingAccentLabel(material: Pick<SpeakingMaterial, 'id' | 'origin'>): string {
  const accent = material.origin === 'platform' ? accents[material.id] ?? speakingSeriesAccent(material.id) : undefined;
  return `口音：${accent ?? '待确认'}`;
}
