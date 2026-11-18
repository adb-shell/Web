# 宝塔 Docker 编排模板

公网 IP 和域名两种部署都使用这份模板。它拉取公开镜像 `tunneluser/voice-room:0.3.1`，供 Ubuntu x86_64 服务器使用。[镜像版本](https://hub.docker.com/r/tunneluser/voice-room/tags)

## 在宝塔中创建编排

1. 以 root 打开宝塔终端，执行下方命令，准备只有管理员可以读取的编排文件。应用的公开网页由 Nginx 反向代理提供。

   ```bash
   install -d -m 700 /www/voice-room
   touch /www/voice-room/compose.yaml
   chmod 600 /www/voice-room/compose.yaml
   ```

2. 在「宝塔 → 文件」编辑 `/www/voice-room/compose.yaml`，复制下方完整 YAML。将 `ZEGO_APP_ID` 的引号内文字换成数字 AppID，将 `ZEGO_SERVER_SECRET` 的引号内文字换成同一项目的 32 位 ServerSecret，然后保存。保留英文双引号和缩进。也可从仓库复制同一份模板。[编排文件](../../voice-room/deploy/compose.bt.yaml) · [ZEGO 项目信息](https://doc-zh.zego.im/console/project-info)
3. 打开「Docker → 容器编排 → 添加容器编排」，名称填 `voice-room`，选择「从文件创建」，指定 `/www/voice-room/compose.yaml`。若面板只有「手动输入」，粘贴刚刚**填好凭据的完整 YAML**。若有编排目录字段，填 `/www/voice-room/`。单独的「环境变量」输入框留空。
4. 点击「创建」或「部署」。填好凭据的文件、面板中的编排副本及备份都包含明文密钥，仅限管理员访问。[宝塔容器编排入口](https://docs.bt.cn/user-guide/docker/compose/backup-restore/)

```yaml
services:
  voice:
    image: tunneluser/voice-room:0.3.1
    container_name: voice-room
    restart: unless-stopped
    environment:
      ZEGO_APP_ID: "替换为数字AppID"
      ZEGO_SERVER_SECRET: "替换为同一项目的32位ServerSecret"
    ports:
      - "127.0.0.1:3080:3080"
    volumes:
      - rooms:/app/data
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:3080/api/health')
          .then(r => r.json()).then(s => process.exit(s.configured ? 0 : 1))
          .catch(() => process.exit(1))
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  rooms:
    name: voice-room_rooms
```

## 启动后检查

```bash
docker ps --filter name=voice-room
curl -fsS http://127.0.0.1:3080/api/health
docker logs --tail 50 voice-room
```

预期能看到容器 `voice-room` 正在运行，健康接口返回 `{"configured":true}`。首次健康检查可能短暂显示 `starting`。这项检查验证凭据格式。用两台设备经 HTTPS 进房并互听，可以验证实际项目凭据。[公网 IP 的 HTTPS 步骤](01-公网IP部署.md) · [域名的 HTTPS 步骤](03-域名部署.md)

| 模板字段 | 部署时的作用 |
|---|---|
| `environment` | 创建容器时将填写的 AppID 和 ServerSecret 传给语音后端。 |
| `127.0.0.1:3080:3080` | 宿主机宝塔 Nginx 访问 `http://127.0.0.1:3080`。访客访问 Nginx 提供的 HTTPS 地址。 |
| `rooms:/app/data` | 房间数据库保存在 Docker 卷 `voice-room_rooms`。更新镜像或重建容器时保留该卷。 |
| `image` | 固定版本便于复现。升级时改成已发布的新版本标签，拉取镜像后重新部署。 |

## 已有编排切换或修改凭据

在原来的 `voice-room` 编排中编辑配置。旧版若使用 `env_file`，将这一项和它下面的文件路径替换成上方的 `environment` 段，从原文件复制两个实际值。如旧配置还指定了 `ZEGO_SERVER` 或 `ROOM_CREATE_CODE`，一并保留在 `environment` 下，以沿用接入地址和已有邀请的签名配置。保留原项目名、端口和数据卷。若面板保存了手动输入的编排副本，同时更新副本。

在宝塔重新部署并**重建容器**，让新配置生效。使用终端管理本教程的编排时，可以执行下面的命令。确认返回 `{"configured":true}`，再用两台设备验证通话。

```bash
cd /www/voice-room
docker compose -p voice-room -f compose.yaml up -d --force-recreate
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3080/api/health
```

若 `configured` 为 `false`，核对实际导入的 YAML 是否已替换两个占位符，再重新部署。若提示 3080 被占用，在终端用 `ss -ltnp 'sport = :3080'` 确认原容器所属的编排，回到该编排更新。
