#!/bin/bash
# 码上顶会 - 一键安装启动脚本

echo "🎓 码上顶会 - 安装依赖..."

# 安装后端依赖
echo "📦 安装后端依赖..."
cd server
npm install
cd ..

# 安装前端依赖
echo "📦 安装前端依赖..."
cd client
npm install
cd ..

# 构建前端
echo "🔨 构建前端..."
cd client
npm run build
cd ..

echo ""
echo "✅ 安装完成！"
echo ""
echo "启动游戏请运行:"
echo "  cd server && npm start"
echo ""
echo "开发模式请运行:"
echo "  # 终端1: cd server && npm run dev"
echo "  # 终端2: cd client && npm run dev"
