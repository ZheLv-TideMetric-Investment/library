#!/bin/bash

# SEC Friendly API PM2 启动脚本

echo "🚀 启动 SEC Friendly API MCP Server..."

# 确保项目已构建
npm run build

# 删除已存在的 PM2 进程（如果有）
pm2 delete sec-friendly-api 2>/dev/null || true

# 启动新的 PM2 进程
pm2 start dist/index.js \
  --name "sec-friendly-api" \
  --interpreter node \
  --watch dist \
  --ignore-watch="node_modules" \
  --log-date-format="YYYY-MM-DD HH:mm:ss Z" \
  --merge-logs \
  --output logs/out.log \
  --error logs/error.log

# 显示状态
pm2 status

echo "✅ SEC Friendly API 已启动!"
echo ""
echo "📊 查看状态: npm run pm2:monit"
echo "📜 查看日志: npm run pm2:logs"
echo "🔄 重启服务: npm run pm2:restart"
echo "⏹️  停止服务: npm run pm2:stop"
echo "🗑️  删除服务: npm run pm2:delete"
echo ""
echo "🌐 健康检查: http://localhost:4000/health"
echo "🔗 SSE 端点: http://localhost:4000/sse" 