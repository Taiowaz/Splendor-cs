import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces } from 'os';
import cors from 'cors';
import { setupWebSocket } from './websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

// 服务前端静态文件（生产模式）
const clientDistPath = join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

// 共享数据（venue 注册表等）
const sharedPath = join(__dirname, '../shared');
app.use('/shared', express.static(sharedPath));

// API: 获取服务器状态
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', message: 'Splendor CS Server is running' });
});

// 所有其他路由返回前端 index.html（SPA 支持）
app.get('*', (req, res) => {
  res.sendFile(join(clientDistPath, 'index.html'));
});

// 设置 WebSocket
setupWebSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎓 Splendor CS Server`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${getLocalIP()}:${PORT}`);
  console.log(`\n   让实验室同学访问上面的 Network 地址即可加入游戏\n`);
});

function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}
