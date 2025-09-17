// PM2 설정 파일 (CommonJS)
module.exports = {
  apps: [
    {
      name: 'speetto-monitor',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=speetto-monitor-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false, // Disable PM2 file monitoring (wrangler handles hot reload)
      instances: 1, // Development mode uses only one instance
      exec_mode: 'fork',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    }
  ]
}