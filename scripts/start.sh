#!/bin/bash

# 确保日志目录存在
mkdir -p logs

# 清理旧的构建文件
rm -rf dist

# 构建项目
echo "Building project..."
npm run build

# 检查构建是否成功
if [ ! -f "dist/index.js" ]; then
    echo "Error: Build failed - dist/index.js not found"
    exit 1
fi

# 停止并删除已存在的进程
echo "Stopping existing process..."
pm2 delete sec-mcp-server 2>/dev/null || true

# 等待进程完全停止
sleep 2

# 启动应用
echo "Starting application..."
pm2 start ecosystem.config.cjs --env production

# 检查启动是否成功
if [ $? -eq 0 ]; then
    echo "Application started successfully"
else
    echo "Error: Failed to start application"
    exit 1
fi 