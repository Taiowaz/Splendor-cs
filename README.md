# 🎓 学术宝石 (Splendor CS)

计算机研究生主题的璀璨宝石桌游，支持局域网多人对战。

## 🎮 游戏规则

扮演计算机研究生，通过收集学术资源、发表论文、获得学术大佬认可来积累声誉。

### 资源类型
- 📊 **数据** (Data)
- 💻 **算力** (Compute)
- 📄 **引用** (Citation)
- 🤝 **合作者** (Collaborator)
- 💰 **经费** (Funding)
- ☕ **咖啡** (Coffee) - 万能资源

### 回合操作（三选一）
1. **拿取资源** - 拿3个不同颜色 或 2个相同颜色
2. **发表论文** - 支付资源购买卡牌，获得永久加成和声誉
3. **预留论文** - 预留一张卡牌并获得1杯咖啡

### 胜利条件
先达到 **15 声誉** 的玩家触发终局，最终声誉最高者获胜。

## 🚀 快速开始

### 前置要求
- Node.js >= 18
- npm >= 9

### 安装步骤

```bash
# 1. 进入项目目录
cd splendor-cs

# 2. 安装后端依赖
cd server
npm install

# 3. 安装前端依赖
cd ../client
npm install

# 4. 构建前端
npm run build
```

### 启动游戏

```bash
# 在 server 目录下
cd server
npm start
```

启动后会显示：
```
🎓 Splendor CS Server
   Local:   http://localhost:3000
   Network: http://192.168.x.x:3000

   让实验室同学访问上面的 Network 地址即可加入游戏
```

### 局域网游玩

1. **房主**：打开浏览器访问 `http://localhost:3000`，创建房间
2. **其他玩家**：在同一局域网下访问 `http://房主IP:3000`，输入房间号加入
3. 房主点击"开始游戏"即可

## 📁 项目结构

```
splendor-cs/
├── server/              # 后端
│   ├── index.js         # 入口文件
│   ├── gameLogic.js     # 游戏逻辑
│   ├── websocket.js     # WebSocket 服务
│   └── package.json
├── client/              # 前端
│   ├── src/
│   │   ├── App.jsx      # 主组件
│   │   ├── components/  # UI 组件
│   │   └── hooks/       # 自定义 hooks
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## 🎯 开发模式

```bash
# 终端1：启动后端（带热重载）
cd server
npm run dev

# 终端2：启动前端开发服务器
cd client
npm run dev
```

前端开发服务器会自动代理 WebSocket 和 API 请求到后端。

## 🛠️ 技术栈

- **前端**: React 18 + Vite
- **后端**: Node.js + Express + ws (WebSocket)
- **通信**: WebSocket 实时双向通信

## 📝 注意事项

- 确保局域网防火墙允许 3000 端口
- 建议使用 Chrome/Edge/Firefox 等现代浏览器
- 游戏状态保存在服务器内存中，刷新页面需要重新加入

## 🎓 主题映射

| 璀璨宝石原版 | 学术宝石版 |
|---|---|
| 5种宝石 | 5种学术资源 |
| 黄金 | 咖啡 |
| 发展卡 | 论文 |
| 贵族 | 学术大佬 |
| 威望点数 | 学术声誉 |

Have fun! 🎉
