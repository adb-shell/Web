#!/usr/bin/env bash
# Set up the dedicated IPv4 voice vhosts on a host-installed BaoTa Nginx.
set -euo pipefail
[[ $EUID == 0 ]] || { echo '请用 sudo 或 root 运行。'; exit 1; }
ip=${1:-}
port=${2:-8443}
python3 - "$ip" "$port" <<'PY'
import ipaddress, sys
try:
    ip = ipaddress.IPv4Address(sys.argv[1])
    assert ip.is_global and not ip.is_multicast and str(ip) == sys.argv[1]
    assert sys.argv[2].isascii() and sys.argv[2].isdigit()
    assert 1 <= int(sys.argv[2]) <= 65535 and int(sys.argv[2]) not in (80, 3080)
    assert str(int(sys.argv[2])) == sys.argv[2]
except (ValueError, AssertionError):
    sys.exit("用法：sudo bash deploy/ip-https.sh 公网IPv4 [专用HTTPS端口，默认8443]")
PY
nginx=/www/server/nginx/sbin/nginx
sites=/www/server/panel/vhost/nginx
root=/var/lib/zego-voice
image=certbot/certbot:v5.4.0
cert=zego-voice-$ip
[[ -x $nginx && -d $sites ]] || { echo '未找到宿主机宝塔 Nginx。容器版或其他路径请参阅 README 中的手动接入。'; exit 1; }
command -v docker systemctl ss flock >/dev/null
mkdir -p "$root"
exec 9>"$root/setup.lock"
flock -n 9 || { echo '已有一个配置任务在运行。'; exit 1; }
mkdir -p "$root/web/.well-known/acme-challenge" "$root/letsencrypt"
chmod 755 "$root" "$root/web" "$root/web/.well-known" "$root/web/.well-known/acme-challenge"
http="$sites/zego-voice-http.conf"
tls="$sites/zego-voice-tls.conf"
mark="# managed by shengjian for $ip:$port"
for file in "$http" "$tls"; do
  if [[ -e $file ]] && [[ $(head -n 1 "$file") != "$mark" ]]; then
    echo "检测到不同的配置 $file，已停止，请核对已有站点。"; exit 1
  fi
done
if [[ ! -e $tls ]] && [[ -n $(ss -ltnH "sport = :$port") ]]; then
  echo "TCP $port 已在使用，请选一个空闲的 HTTPS 端口。"; exit 1
fi
tempdir=$(mktemp -d)
trap 'rm -f "$tempdir/http" "$tempdir/tls" "$tempdir/previous" "$tempdir/nginx-dump"; rmdir "$tempdir"' EXIT
"$nginx" -T >"$tempdir/nginx-dump" 2>&1
if [[ ! -e $http ]] && awk -v addr="$ip" '$1=="server_name"{for(i=2;i<=NF;i++){gsub(/;/,"",$i); if($i==addr) found=1}} END{exit !found}' "$tempdir/nginx-dump"; then
  echo '该 IP 已被现有 Nginx 站点使用。请按 README 的手动接入步骤复用站点。'; exit 1
fi
install_vhost() {
  local source=$1 destination=$2
  [[ ! -e $destination ]] || cp "$destination" "$tempdir/previous"
  install -m 0644 "$source" "$destination"
  if ! "$nginx" -t || ! "$nginx" -s reload; then
    if [[ -f $tempdir/previous ]]; then cp "$tempdir/previous" "$destination"; else rm -f "$destination"; fi
    echo '新配置未启用，已恢复原配置。'; exit 1
  fi
  rm -f "$tempdir/previous"
}
url="https://$ip:$port"
[[ $port != 443 ]] || url="https://$ip"
cat > "$tempdir/http" <<EOF
$mark
server {
    listen 80;
    server_name $ip;
    location ^~ /.well-known/acme-challenge/ { root $root/web; try_files \$uri =404; }
    location / { return 302 $url\$request_uri; }
}
EOF
install_vhost "$tempdir/http" "$http"
probe=$(openssl rand -hex 10)
printf '%s' "$probe" > "$root/web/.well-known/acme-challenge/$probe"
got=''
for ((i=0;i<5;i++)); do
  got=$(curl --noproxy '*' -fsS --max-time 5 -H "Host: $ip" "http://127.0.0.1/.well-known/acme-challenge/$probe" 2>/dev/null) || got=''
  [[ $got != "$probe" ]] || break
  sleep 1
done
rm -f "$root/web/.well-known/acme-challenge/$probe"
[[ $got == "$probe" ]] || { echo 'Nginx 未正确提供验证目录，请检查宝塔站点 include 和监听配置。'; exit 1; }
docker run --rm -v "$root/letsencrypt:/etc/letsencrypt" -v "$root/web:/web" "$image" certonly \
  --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring \
  --preferred-profile shortlived --webroot -w /web --cert-name "$cert" --ip-address "$ip"
cat > "$tempdir/tls" <<EOF
$mark
server {
    listen $port ssl default_server;
    server_name $ip;
    ssl_certificate $root/letsencrypt/live/$cert/fullchain.pem;
    ssl_certificate_key $root/letsencrypt/live/$cert/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 8k;
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF
install_vhost "$tempdir/tls" "$tls"
# Store renewal logic on the host so replacing the application release is safe.
cat > "$root/renew.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
docker run --rm -v "$root/letsencrypt:/etc/letsencrypt" -v "$root/web:/web" $image renew --cert-name "$cert" --quiet
"$nginx" -t
"$nginx" -s reload
EOF
chmod 700 "$root/renew.sh"
cat >/etc/systemd/system/zego-voice-renew.service <<EOF
[Unit]
Description=Renew the ZEGO test room IPv4 certificate
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=/bin/bash $root/renew.sh
EOF
cat >/etc/systemd/system/zego-voice-renew.timer <<'EOF'
[Unit]
Description=Check the voice room certificate twice daily
[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now zego-voice-renew.timer
curl --noproxy '*' --connect-to "$ip:$port:127.0.0.1:$port" -fsS --max-time 10 "$url/api/health"
printf '\n测试地址 %s\n' "$url"
