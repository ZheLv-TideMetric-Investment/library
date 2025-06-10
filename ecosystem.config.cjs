module.exports = {
  apps: [
    {
      name: 'library',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      // 设置日志轮转
      log_rotate_interval: '0 0 * * *', // 每天午夜轮转
      log_rotate_max_size: '10M', // 单个日志文件最大 10MB
      log_rotate_keep: 7, // 保留 7 天的日志
    },
  ],
}; 