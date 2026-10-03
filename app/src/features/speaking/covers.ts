import type { ImageSourcePropType } from 'react-native';
import { speakingSeriesId } from './series';
import { speakingPodcastId } from './podcasts';

/** 固定素材的真实视频画面，与安装包和 Web 静态资源一起发布。 */
const covers: Record<string, ImageSourcePropType> = {
  'tim-cook-stanford-2019': require('../../../assets/speaking/covers/tim-cook-stanford-2019.jpg'),
  'trump-inauguration-2017': require('../../../assets/speaking/covers/trump-inauguration-2017.jpg'),
  'jk-rowling-harvard-2008': require('../../../assets/speaking/covers/jk-rowling-harvard-2008.jpg'),
  'jensen-huang-caltech': require('../../../assets/speaking/covers/jensen-huang-caltech.jpg'),
  'denzel-washington-penn-2011': require('../../../assets/speaking/covers/denzel-washington-penn-2011.jpg'),
  'steve-jobs-stanford-2005': require('../../../assets/speaking/covers/steve-jobs-stanford-2005.jpg'),
  'trump-west-point': require('../../../assets/speaking/covers/trump-west-point.jpg'),
  'forrest-gump-1994': require('../../../assets/speaking/covers/forrest-gump-1994.jpg'),
  'titanic-1997': require('../../../assets/speaking/covers/titanic-1997.jpg'),
  'the-odyssey-local': require('../../../assets/speaking/covers/the-odyssey-local.jpg'),
  'fight-club-1999': require('../../../assets/speaking/covers/fight-club-1999.jpg'),
  'inside-out-2015': require('../../../assets/speaking/covers/inside-out-2015.jpg'),
  'michael-2026': require('../../../assets/speaking/covers/michael-2026.jpg'),
  'project-hail-mary-2026': require('../../../assets/speaking/covers/project-hail-mary-2026.jpg'),
  'the-godfather-1972': require('../../../assets/speaking/covers/the-godfather-1972.jpg'),
  'the-shawshank-redemption-1994': require('../../../assets/speaking/covers/the-shawshank-redemption-1994.jpg'),
  'avatar-aang-2026': require('../../../assets/speaking/covers/avatar-aang-2026.jpg'),
  'primetime-2026': require('../../../assets/speaking/covers/primetime-2026.jpg'),
  'zootopia-2-2025': require('../../../assets/speaking/covers/zootopia-2-2025.jpg'),
  friends: require('../../../assets/speaking/covers/friends.jpg'),
  'rick-and-morty': require('../../../assets/speaking/covers/rick-and-morty.jpg'),
  'joe-rogan-experience': require('../../../assets/speaking/covers/joe-rogan-experience.jpg'),
  'the-diary-of-a-ceo': require('../../../assets/speaking/covers/the-diary-of-a-ceo.jpg'),
  'the-iced-coffee-hour': require('../../../assets/speaking/covers/the-iced-coffee-hour.jpg'),
};

export const speakingCover = (id: string): ImageSourcePropType | undefined =>
  covers[id] ?? covers[speakingSeriesId(id) ?? speakingPodcastId(id) ?? ''];
