// 贵族卡（FC 卡）注册表
// tier: 'pair' = 双色 4+4（会士），'triple' = 三色 3+3+3（院士）
// 分值全部 3 分，与官方 Splendor 一致
//
// 平衡约束：5 种资源各出现 5 次。双色走 5-圈（数→算→引→合→费）的相邻边，
// 每种资源 2 次；三色走同一 5-圈的相邻三元组，每种资源 3 次。
// 三色不能取 6 张：18 ÷ 5 非整数，所以三色只能 5 的倍数。
// enabled:false 的是 bench，不进牌池。

export const NOBLES = [
  // ---------- 双色会士（4+4） ----------
  {
    id: 'acm',
    name: 'ACM Fellow',
    cn: 'ACM 会士',
    sub: '美国计算机学会',
    requirement: { compute: 4, citation: 4 },
    prestige: 3,
    tier: 'pair',
    enabled: true
  },
  {
    id: 'ieee',
    name: 'IEEE Fellow',
    cn: 'IEEE 会士',
    sub: '电气电子工程师学会',
    requirement: { collaborator: 4, funding: 4 },
    prestige: 3,
    tier: 'pair',
    enabled: true
  },
  {
    id: 'aaai',
    name: 'AAAI Fellow',
    cn: 'AAAI 会士',
    sub: '国际先进人工智能协会',
    requirement: { data: 4, compute: 4 },
    prestige: 3,
    tier: 'pair',
    enabled: true
  },
  {
    id: 'acl',
    name: 'ACL Fellow',
    cn: 'ACL 会士',
    sub: '国际计算语言学学会',
    requirement: { funding: 4, data: 4 },
    prestige: 3,
    tier: 'pair',
    enabled: true
  },
  {
    id: 'ccf',
    name: 'CCF Fellow',
    cn: 'CCF 会士',
    sub: '中国计算机学会',
    requirement: { citation: 4, collaborator: 4 },
    prestige: 3,
    tier: 'pair',
    enabled: true
  },

  // ---------- 三色院士（3+3+3） ----------
  {
    id: 'cas',
    name: 'CAS Member',
    cn: '中科院院士',
    sub: '中国科学院',
    requirement: { data: 3, compute: 3, citation: 3 },
    prestige: 3,
    tier: 'triple',
    enabled: true
  },
  {
    id: 'cae',
    name: 'CAE Member',
    cn: '工程院院士',
    sub: '中国工程院',
    requirement: { compute: 3, citation: 3, collaborator: 3 },
    prestige: 3,
    tier: 'triple',
    enabled: true
  },
  {
    id: 'ae',
    name: 'AE Member',
    cn: '欧科院院士',
    sub: '欧洲人文和自然科学院',
    requirement: { citation: 3, collaborator: 3, funding: 3 },
    prestige: 3,
    tier: 'triple',
    enabled: true
  },
  {
    id: 'rs',
    name: 'RS Fellow',
    cn: '皇家学会会士',
    sub: '英国皇家学会',
    requirement: { collaborator: 3, funding: 3, data: 3 },
    prestige: 3,
    tier: 'triple',
    enabled: true
  },
  {
    id: 'nas',
    name: 'NAS Member',
    cn: '美国科学院院士',
    sub: '美国国家科学院',
    requirement: { funding: 3, data: 3, compute: 3 },
    prestige: 3,
    tier: 'triple',
    enabled: true
  },

  // ---------- bench：不进牌池，想换卡改 enabled 即可 ----------
  {
    id: 'twas',
    name: 'TWAS Mem.',
    cn: '发展中国家科学院院士',
    sub: '发展中国家科学院',
    requirement: { data: 3, compute: 3, collaborator: 3 },
    prestige: 3,
    tier: 'triple',
    enabled: false
  },
  {
    id: 'aaas',
    name: 'AAAS Fellow',
    cn: 'AAAS 会士',
    sub: '美国科学促进会',
    requirement: { data: 4, citation: 4 },
    prestige: 3,
    tier: 'pair',
    enabled: false
  },
  {
    id: 'fake',
    name: 'Fake Fellow',
    cn: '洋院士',
    sub: '山寨院 · 花钱就能买',
    requirement: { funding: 4 },
    prestige: 1,
    tier: 'pair',
    enabled: false
  }
]

export const ACTIVE_NOBLES = NOBLES.filter(n => n.enabled)
