@echo off
chcp 65001 >nul
echo 🎓 码上顶会 - 安装依赖...

echo 📦 安装后端依赖...
cd server
call npm install
cd ..

echo 📦 安装前端依赖...
cd client
call npm install
cd ..

echo 🔨 构建前端...
cd client
call npm run build
cd ..

echo.
echo ✅ 安装完成！
echo.
echo 启动游戏请运行:
echo   cd server ^&^& npm start
echo.
echo 开发模式请运行:
echo   终端1: cd server ^&^& npm run dev
echo   终端2: cd client ^&^& npm run dev
pause
