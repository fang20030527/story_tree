import type { ImageSourcePropType } from 'react-native';

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
};

export const speakingCover = (id: string): ImageSourcePropType | undefined => covers[id];
