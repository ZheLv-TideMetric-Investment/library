require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'sec-mcp-server',
      script: 'tsx',
      args: 'src/index.ts',
      watch: true,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        SEC_API_MAIL: process.env.SEC_API_MAIL,
        SEC_API_COMPANY: process.env.SEC_API_COMPANY,
        PORT: process.env.PORT || 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        SEC_API_MAIL: process.env.SEC_API_MAIL,
        SEC_API_COMPANY: process.env.SEC_API_COMPANY,
        PORT: process.env.PORT || 3000,
      },
    },
  ],
};
