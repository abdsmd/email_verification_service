/**
 * PM2: `pm2 start ecosystem.config.js`
 * Ensure log dir exists and is writable, e.g.:
 *   sudo mkdir -p /var/log/verification-station && sudo chown "$USER" /var/log/verification-station
 */
export default {
  apps: [
    {
      name: "verification-station",
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      out_file: "/var/log/verification-station/out.log",
      error_file: "/var/log/verification-station/error.log",
      merge_logs: false,
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
      },
    },
  ],
};
