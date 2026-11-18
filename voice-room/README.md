# 声间 · 网页语音通话测试版

打开语音大厅即可创建房间。加入者可以输入六位房间号、点击列表中的「加入」，或打开邀请链接后点击「加入语音房间」。浏览器只申请麦克风权限。成员进入房间时按顺序显示为用户01、用户02等。网页使用 ZEGO Express Web SDK 3.13.0，服务器签发 Token04，音频通过 ZEGO 传输。

## Ubuntu 和宝塔部署

当前站点使用标准 HTTPS 端口 443。应用容器在宿主机 `127.0.0.1:3080` 提供 HTTP，由现有宝塔 Nginx 转发。公网 IP 证书由 Let's Encrypt 签发，部署脚本安装每天检查两次的续期任务。[IP 证书官方说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)

1. 在 ZEGO 控制台打开已创建项目的“项目信息”，准备 **AppID** 和 **ServerSecret**。新项目默认已开通实时音视频。ServerSecret 只在服务器终端输入。[项目信息](https://doc-zh.zego.im/console/project-info) · [实时音视频服务](https://doc-zh.zego.im/console/service-configuration/rtc)
2. 在云安全组和 Ubuntu／宝塔防火墙允许入站 **TCP 80** 和 **TCP 443**。80 用于证书签发与续期，443 用于通话网页。3080 保持本机访问。使用固定或稳定的公网 IPv4。
3. 首次搭建时，把发布包上传至服务器的 `/www/wwwroot`，在宝塔终端执行以下命令。已有本项目 HTTPS 配置的服务器，升级时只需解包并运行 `deploy/start.sh`。

```bash
cd /www/wwwroot
tar -xzf shengjian-voice-0.3.1.tar.gz
cd voice-room
sudo bash deploy/start.sh
read -rp '服务器公网 IPv4: ' VOICE_IP
sudo bash deploy/ip-https.sh "$VOICE_IP" 443
```

首次运行 `start.sh` 会隐藏输入 ServerSecret，把配置写入仅管理员可读的 `.env`。升级会沿用原配置，保留旧版配置可让有效期内的原邀请链接继续使用。服务器需能拉取 Node、Certbot 官方 Docker 镜像及 npm 依赖。

`ip-https.sh` 适用于 **Nginx 安装在宿主机的标准宝塔路径**。它使用 `/www/server/nginx/sbin/nginx`，在 `/www/server/panel/vhost/nginx/` 新增本项目的 HTTP 和 HTTPS 配置，检查语法并平滑重载。HTTP-01 验证沿用运行中的 80 端口。首次搭建时若 443 已被其他站点占用，可使用单独的空闲端口，例如 8443，并在防火墙放行对应的端口。

## 两台设备验证

1. 房主在桌面浏览器打开 HTTPS 首页，点击“创建并加入”，允许麦克风。页面显示六位房间号。其他人可在大厅继续独立建房。
2. 访客可以直接点击列表中的“加入”，也可以输入房号加入。使用“复制邀请链接”分享完整链接时，访客打开链接后点击“加入语音房间”即可。大厅会实时更新房间和在线人数。
3. 双方交替说话，确认彼此能听见。首次播放受浏览器限制时点击“点击恢复对方声音”。同处一室测试时使用耳机。
4. 一方点击“麦克风静音”，确认另一方听不到其发言，恢复后应重新有声。离开后浏览器应释放麦克风，另一方成员数应减少。再次打开同一邀请链接验证重新加入。
5. 编号在每个房间内独立递增。网络自动重连时保留编号，主动离开后再次进入会取得下一个编号。在测试大厅点击某行的“关闭”，该房间的成员会返回大厅，房号与原邀请链接同时失效。

测试大厅中的房间公开可加入。房号和链接从建房起有效 12 小时，所有人离开后，空房间仍可在此期间重复使用。房间号存储在 Compose 的 `rooms` 数据卷中，保留卷即可在容器重建后继续使用。大厅通过服务器事件推送同步，断线后自动尝试重连。语音 Token 有效期最长一小时，在会话有效期内自动续期。ZEGO 侧的房间和推流权限验证取决于项目是否开通相应权限认证。[ZEGO Token 鉴权](https://doc-zh.zego.im/real-time-voice-web/communication/using-token-authentication)

## 检查运行状态

```bash
cd /www/wwwroot/voice-room
sudo docker compose ps
curl -fsS http://127.0.0.1:3080/api/health
sudo docker compose logs --tail 50
systemctl list-timers zego-voice-renew.timer
sudo journalctl -u zego-voice-renew.service -n 30
```

`configured: true` 表示应用已读到格式有效的服务配置。实际 AppID 和密钥是否属于同一个可用的 ZEGO 项目，以两端成功进房和通话为准。若建房后登录失败，优先核对 AppID、ServerSecret 和服务状态。使用项目指定接入地址时，可在 `.env` 增加 `ZEGO_SERVER` 后重新执行 `start.sh`。

证书签发失败时，先从外网确认 80 能直达此 IPv4，检查云安全组、NAT 和宝塔防火墙。网络修复后可重跑 `ip-https.sh`。更换公网 IP 后需要为新地址签发证书、更新 Nginx 并重新分享链接。

## 已有 IP 站点或容器版 Nginx

如果现有站点已为该 IP 提供浏览器信任的 HTTPS，直接将该站点的 `location /` 反代到本项目即可。宿主机 Nginx 使用下面的配置。Nginx 运行在容器里时，应将它与应用接入同一个 Docker 网络，并把上游改为应用服务名 `voice:3080`。

```nginx
location / {
    proxy_pass http://127.0.0.1:3080;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
}
```

如果已有 IP 站点只提供 HTTP，可在该站点中单独配置 `/.well-known/acme-challenge/` 对应的 webroot，按官方的 Certbot 5.4+ 流程签发 IP 证书，将证书和私钥配置到该 IP 的 HTTPS 监听，并在定时续期后重载对应的 Nginx。容器版 Nginx 需挂载同一验证目录和证书目录。[Certbot IP 证书命令与参数](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)

## 本机开发

使用 Node 22.13+ 和 npm，在本目录运行 `npm ci --ignore-scripts`。复制 `.env.example` 为 `.env` 并填写配置，再运行 `npm start`，从本机打开 `http://localhost:3080`。运行 `npm test` 可验证并行建房、重启持久化、列表推送、旧邀请兼容、语音凭证签发和续期。前端依赖由同一服务提供。
