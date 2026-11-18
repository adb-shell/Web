#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose version >/dev/null || { echo '请先安装 Docker Compose v2 插件。'; exit 1; }
if [[ ! -f .env ]]; then
  read -rp 'ZEGO AppID（数字）: ' app_id
  read -rsp 'ZEGO ServerSecret（输入隐藏）: ' secret
  echo
  [[ "$app_id" =~ ^[1-9][0-9]{0,9}$ && "$secret" =~ ^[a-zA-Z0-9]{32}$ ]] || { echo '请核对 AppID 和 32 位 ServerSecret。'; exit 1; }
  (umask 077; set -o noclobber; printf 'ZEGO_APP_ID=%s\nZEGO_SERVER_SECRET=%s\n' "$app_id" "$secret" > .env)
  unset secret
fi
docker compose up -d --build
for ((i=0;i<30;i++)); do
  if curl -fsS --max-time 2 http://127.0.0.1:3080/api/health 2>/dev/null | grep -q '"configured":true'; then
    echo '应用已就绪，正在本机 3080 端口等待 Nginx 转发。'
    exit 0
  fi
  sleep 1
done
echo '应用尚未就绪，请检查 .env 和 docker compose logs --tail 30。'
exit 1
