# 跟读素材概述

素材详情页用对应内容的中文概述替换通用跟读提示和字幕首句，标题卡的引导语改为素材分类。现有七段演讲和三部电影的概述按平台素材 ID 匹配；个人导入素材和未收录的素材暂不显示概述。

概述由下列原文、官方影片简介及当前素材字幕整理为中文，保存在 `app/src/features/speaking/overviews.ts`。

| 素材 | 内容核对来源 |
| --- | --- |
| 乔布斯 · 2005 斯坦福毕业演讲 | [斯坦福演讲原文](https://news.stanford.edu/stories/2005/06/youve-got-find-love-jobs-says) |
| 库克 · 2019 斯坦福毕业演讲 | [斯坦福演讲原文](https://news.stanford.edu/stories/2019/06/remarks-tim-cook-2019-stanford-commencement) |
| 罗琳 · 2008 哈佛毕业演讲 | [作者发布的演讲介绍](https://www.jkrowling.com/harvard-commencement-address/)及当前素材字幕 |
| 黄仁勋 · 加州理工毕业演讲 | [英伟达演讲报道](https://blogs.nvidia.com/blog/jensen-huang-caltech-commencement-address/)及当前素材字幕 |
| 丹泽尔·华盛顿 · 2011 宾大毕业演讲 | [宾大演讲原文](https://almanac.upenn.edu/archive/volumes/v57/n34/comm-washington.html) |
| 特朗普 · 2017 就职演讲 | [白宫历史档案原文](https://trumpwhitehouse.archives.gov/briefings-statements/the-inaugural-address/) |
| 特朗普 · 西点军校毕业演讲 | [西点演讲记录](https://mwi.westpoint.edu/wp-content/uploads/2025/05/Modern-War-Journal-MWJ-first-edition-FINAL-as-of-01JUN25-pdf.pdf)及当前素材字幕 |
| 阿甘正传 | [派拉蒙影片简介](https://www.paramountpictures.com/movies/forrest-gump) |
| 泰坦尼克号 | [派拉蒙影片简介](https://www.paramountpictures.com/movies/titanic) |
| 奥德赛 · The Odyssey | 当前素材字幕中的特洛伊战争、奥德修斯归乡及佩内洛佩情节 |

概述与字幕分开维护，进入影子跟读后仍使用完整字幕。
