export interface GenrePreset {
  id: string
  name: string
  description: string
}

export const GENRE_PRESETS: GenrePreset[] = [
  { id: 'xuanhuan', name: '玄幻', description: '升级打怪、境界突破、法宝丹药' },
  { id: 'xianxia', name: '仙侠', description: '修仙问道、仙凡之别、道心情劫' },
  { id: 'wuxia', name: '武侠', description: '武功秘籍、江湖恩怨、侠义精神' },
  { id: 'urban', name: '都市', description: '现代都市、异能觉醒、商战权谋' },
  { id: 'scifi', name: '科幻', description: '星际探索、机甲战斗、文明兴衰' },
  { id: 'mystery', name: '悬疑', description: '案件推理、真相揭露、心理博弈' },
  { id: 'history', name: '历史', description: '朝堂权谋、军事征伐、文明建设' },
  { id: 'gongdou', name: '宫斗', description: '后宫争宠、权谋算计、步步为营' },
  { id: 'game', name: '游戏', description: '电竞比赛、游戏世界、团队协作' },
  { id: 'wuxian', name: '无限流', description: '副本闯关、规则怪谈、团队生存' },
  { id: 'zhibo', name: '直播', description: '直播互动、弹幕文化、即时事件' },
  { id: 'honghuang', name: '洪荒', description: '混沌初开、封神演义、天道因果' },
  { id: 'yanqing', name: '言情', description: '爱情主线、情感纠葛、甜蜜互动' },
  { id: 'xitong', name: '系统流', description: '签到抽奖、任务升级、数值体系' },
  { id: 'youxi_lit', name: '游戏文学', description: '游戏叙事、角色深度、多线结局' },
  { id: 'cosmic_horror', name: '宇宙恐怖', description: '未知恐惧、理智侵蚀、不可名状' },
  { id: 'history_travel', name: '历史穿越', description: '时空穿越、蝴蝶效应、古今碰撞' },
]
