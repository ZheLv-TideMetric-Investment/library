/** @type {import('pm2').Config} */
export default {
  apps: [
    {
      name: 'sec-mcp-server',
      script: 'src/index.ts',
      interpreter: 'node',
      interpreter_args: '--loader tsx',
      env: {
        NODE_ENV: 'production',
        PORT: '4000',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: '4000',
      },
      watch: ['src'],
      ignore_watch: ['node_modules', 'dist'],
      max_memory_restart: '1G',
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      restart_delay: 3000,
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      log_type: 'json',
    },
  ],
};
