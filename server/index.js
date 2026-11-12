import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces } from 'os';
import cors from 'cors';
import { setupWebSocket } from './websocket.js';
import { register, login, verifyToken, AuthError } from './accounts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

// 共享数据（venue 注册表等）
const sharedPath = join(__dirname, '../shared');
app.use('/shared', express.static(sharedPath));

// 服务前端静态文件（生产模式）
const clientDistPath = join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

// API: 获取服务器状态
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', message: 'Splendor CS Server is running' });
});

// 账号：注册 / 登录发 token，/api/me 拿 token 换身份（查登录还在不在）。
// 密码只存 scrypt 哈希，token 是 HMAC 签名的无状态会话（见 accounts.js）。
const authFail = (res, err) => {
  const status = err instanceof AuthError ? err.status : 500;
  if (status === 500) console.error('Auth error:', err);
  res.status(status).json({ error: err.message || '服务器出错' });
};

app.post('/api/register', (req, res) => {
  try {
    res.json(register(req.body?.name, req.body?.password));
  } catch (err) {
    authFail(res, err);
  }
});

app.post('/api/login', (req, res) => {
  try {
    res.json(login(req.body?.name, req.body?.password));
  } catch (err) {
    authFail(res, err);
  }
});

app.get('/api/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: '未登录或登录已过期' });
  res.json({ user });
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
