// pm2 process file for a single-process production run:
//   npm run build:all && pm2 start ecosystem.config.cjs
// The API serves the built web app (SERVE_CLIENT_DIST) on one origin.
// Secrets come from server/.env (see server/.env.example) — never put them here.
module.exports = {
  apps: [
    {
      name: 'studyos',
      cwd: './server',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        SERVE_CLIENT_DIST: '../dist'
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
