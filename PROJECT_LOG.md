# 学术宝石 (Splendor CS) - 项目开发记录

## 项目概述

**项目名称**: 学术宝石 (Splendor CS / Splendor: Computer Science Edition)  
**项目类型**: 局域网多人网页桌游  
**灵感来源**: 璀璨宝石 (Splendor) 桌游  
**目标用户**: 计算机研究生实验室同学  
**开发日期**: 2026-11-04

---

## 对话记录

### 1. 初始想法 (2026-11-04)

**用户**: "璀璨宝石，你知道这个游戏吗"

**助手**: 确认了解 Splendor 游戏，介绍了核心玩法：
- 收集宝石筹码
- 购买发展卡积累威望
- 贵族板子自动访问机制
- 先到 15 威望获胜

**用户**: "我在想能否构建一个类似的游戏，不过是以计算机研究生为背景，换成paper之类的，同时能在局域网实验室一起玩，大概就是我的idea"

**核心需求**:
1. 类似 Splendor 的游戏机制
2. 计算机研究生主题（paper、学术资源等）
3. 局域网多人对战
4. 实验室环境使用

---

### 2. 设计决策

通过询问确认了以下方向：

| 决策项 | 选择 |
|--------|------|
| 技术栈 | Web (React + Node.js) |
| 游戏机制 | 忠实还原 Splendor |
| 玩家规模 | 2-4 人 |

---

### 3. 主题映射设计

**资源系统**:
| Splendor 原版 | 学术宝石版 | 图标 |
|---------------|-----------|------|
| 白色宝石 | 数据 (Data) | 📊 |
| 蓝色宝石 | 算力 (Compute) | 💻 |
| 绿色宝石 | 引用 (Citation) | 📄 |
| 红色宝石 | 合作者 (Collaborator) | 🤝 |
| 黑色宝石 | 经费 (Funding) | 💰 |
| 黄金（万能）| 咖啡 (Coffee) | ☕ |

**卡牌系统**:
| Splendor 原版 | 学术宝石版 | 说明 |
|---------------|-----------|------|
| 1级发展卡 | 入门论文 (Workshop) | 绿色边框，成本低 |
| 2级发展卡 | 期刊论文 (Journal) | 蓝色边框，中等成本 |
| 3级发展卡 | 顶会论文 (Top Conference) | 紫色边框，成本高 |
| 贵族板子 | 学术大佬 | 图灵奖得主、IEEE Fellow、院士等 |
| 威望点数 | 学术声誉 | 先到 15 获胜 |

**学术大佬示例**:
- 图灵奖得主 (需要 数据×4 + 算力×4)
- IEEE Fellow (需要 算力×4 + 引用×4)
- 长江学者 (需要 合作者×4 + 经费×4)
- 院士 (需要 数据×5 + 算力×3 + 引用×3)
- Nature 审稿人 (需要 引用×5 + 合作者×3 + 经费×3)

---

### 4. 技术架构

**前端**:
- React 18
- Vite 构建工具
- WebSocket 客户端
- 组件结构:
  - `Lobby.jsx` - 大厅（创建/加入房间）
  - `GameBoard.jsx` - 游戏主界面
  - `PaperCard.jsx` - 论文卡牌组件
  - `NobleTile.jsx` - 学术大佬组件
  - `ResourceTokens.jsx` - 资源token组件
  - `PlayerPanel.jsx` - 玩家信息面板

**后端**:
- Node.js + Express
- ws (WebSocket 库)
- 游戏逻辑引擎 (`gameLogic.js`)
- WebSocket 服务 (`websocket.js`)
- 房间管理系统

**通信协议**:
```javascript
// 客户端 → 服务器消息类型
{
  type: 'create_room',      // 创建房间
  type: 'join_room',        // 加入房间
  type: 'start_game',       // 开始游戏
  type: 'take_tokens',      // 拿取资源
  type: 'buy_card',         // 购买卡牌
  type: 'reserve_card',     // 预留卡牌
  type: 'list_rooms'        // 列出房间
}

// 服务器 → 客户端消息类型
{
  type: 'room_created',     // 房间创建成功
  type: 'joined_room',      // 加入房间成功
  type: 'player_joined',    // 玩家加入
  type: 'player_left',      // 玩家离开
  type: 'game_started',     // 游戏开始
  type: 'tokens_taken',     // 资源被拿取
  type: 'card_bought',      // 卡牌被购买
  type: 'card_reserved',    // 卡牌被预留
  type: 'noble_visit',      // 贵族访问
  type: 'turn_changed',     // 回合切换
  type: 'game_over',        // 游戏结束
  type: 'error'             // 错误信息
}
```

---

### 5. 游戏规则实现

**回合流程**:
1. 当前玩家执行三个操作之一:
   - **拿取资源**: 3个不同颜色 或 2个相同颜色（银行该颜色≥4）
   - **购买论文**: 支付资源费用，获得永久加成 + 声誉
   - **预留论文**: 预留1张卡牌，获得1杯咖啡（万能资源）

2. 回合结束后检查:
   - 是否有学术大佬来访（满足条件自动获得额外声誉）
   - 是否有玩家达到 15 声誉（触发终局）

3. 切换到下一个玩家

**资源限制**:
- 玩家最多持有 10 个资源token
- 最多预留 3 张卡牌
- 咖啡（万能资源）可以替代任何颜色

**胜利条件**:
- 先达到 15 声誉的玩家触发最后一轮
- 所有玩家完成相同回合数后，声誉最高者获胜

---

### 6. 项目文件结构

```
splendor-cs/
├── server/                    # 后端
│   ├── index.js              # Express + WebSocket 入口
│   ├── gameLogic.js          # 游戏核心逻辑（90行卡牌生成 + 规则引擎）
│   ├── websocket.js          # WebSocket 服务（房间管理 + 消息处理）
│   └── package.json          # 依赖: express, ws, cors
│
├── client/                    # 前端
│   ├── src/
│   │   ├── main.jsx          # React 入口
│   │   ├── App.jsx           # 主应用组件
│   │   ├── index.css         # 全局样式（暗色主题）
│   │   ├── App.css           # 大厅样式
│   │   ├── components/
│   │   │   ├── Lobby.jsx     # 大厅界面
│   │   │   ├── GameBoard.jsx # 游戏主界面
│   │   │   ├── GameBoard.css
│   │   │   ├── PaperCard.jsx # 论文卡牌
│   │   │   ├── PaperCard.css
│   │   │   ├── NobleTile.jsx # 学术大佬
│   │   │   ├── NobleTile.css
│   │   │   ├── ResourceTokens.jsx # 资源token
│   │   │   ├── ResourceTokens.css
│   │   │   ├── PlayerPanel.jsx    # 玩家面板
│   │   │   └── PlayerPanel.css
│   │   └── hooks/
│   │       └── useWebSocket.js    # WebSocket 连接管理
│   ├── index.html
│   ├── vite.config.js        # Vite 配置（含 WebSocket 代理）
│   └── package.json          # 依赖: react, react-dom, vite
│
├── README.md                  # 项目说明文档
├── setup.sh                   # Linux/Mac 一键安装脚本
├── setup.bat                  # Windows 一键安装脚本
└── .gitignore
```

---

### 7. 当前状态

**已完成**:
- ✅ 完整的游戏逻辑引擎
- ✅ WebSocket 实时通信
- ✅ 房间创建/加入系统
- ✅ 前端所有 UI 组件
- ✅ 暗色主题样式
- ✅ 项目文档和启动脚本

**待完成**:
- ⏳ 安装 Node.js（系统当前未安装）
- ⏳ 安装项目依赖 (`npm install`)
- ⏳ 构建前端 (`npm run build`)
- ⏳ 本地测试运行
- ⏳ 部署到 ausu-sever-albin 服务器

---

### 8. 部署计划

**目标服务器**: ausu-sever-albin  
**部署方式**: 待确认（需要服务器连接信息）

**部署步骤**（待执行）:
1. 打包项目文件
2. 上传到服务器（scp/rsync）
3. 服务器安装依赖
4. 构建前端
5. 启动服务（可能需要 pm2 等进程管理器）
6. 配置防火墙（开放 3000 端口）
7. 测试访问

---

### 9. 后续扩展想法

**可能的功能增强**:
- 💬 游戏内聊天系统
- 👀 观战模式
- 🤖 AI 玩家（单人模式）
- 📊 战绩统计和排行榜
- 🎨 更多主题皮肤
- 🔊 音效和动画
- 📱 移动端适配优化
- 🎯 自定义规则选项

**平衡性调整**:
- 可能需要根据实际测试调整卡牌数值
- 学术大佬的访问条件可以微调
- 资源数量可以根据玩家反馈优化

---

### 10. 技术要点

**关键实现细节**:

1. **状态同步**: 服务器维护权威游戏状态，客户端只负责渲染和用户交互
2. **信息隐藏**: 其他玩家的资源token只显示咖啡数量，隐藏具体分布
3. **断线重连**: WebSocket 自动重连机制（3秒间隔）
4. **回合验证**: 所有操作都在服务器端验证合法性
5. **响应式设计**: 使用 flexbox 和 overflow 处理不同屏幕尺寸

**安全考虑**:
- 所有游戏逻辑在服务器端执行
- 客户端无法直接修改游戏状态
- WebSocket 消息需要验证来源玩家

---

## 总结

这是一个完整的局域网多人网页游戏项目，将经典的璀璨宝石桌游机制与计算机研究生主题完美结合。项目采用现代 Web 技术栈（React + Node.js + WebSocket），实现了实时多人对战功能。

**项目特色**:
- 🎓 独特的学术主题（论文、资源、学术大佬）
- 🌐 局域网即开即用（浏览器直接访问）
- ⚡ 实时同步（WebSocket 双向通信）
- 🎨 精美的暗色 UI 设计
- 📦 完整的项目结构和文档

**下一步**: 安装 Node.js → 安装依赖 → 本地测试 → 部署到服务器 → 实验室开黑！🎉

---

*文档生成时间: 2026-11-04*  
*项目版本: v1.0.0 (初始版本)*
