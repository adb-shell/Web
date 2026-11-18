# 声间 · 网页语音房间

浏览器通过麦克风加入语音房间，支持六位房号、邀请链接、实时成员列表和静音。[房间使用说明](voice-room/README.md)

## 在宝塔部署

1. 将[宝塔编排模板](voice-room/deploy/compose.bt.yaml)保存到新服务器的 `/www/voice-room/compose.yaml`。
2. 在文件的 `environment` 下，把 `ZEGO_APP_ID` 和 `ZEGO_SERVER_SECRET` 两个占位符替换为同一个项目的 AppID 和 ServerSecret，保留英文双引号。填写后的文件只保存在服务器上。
3. 在宝塔「Docker → 容器编排」中导入该文件并部署，再根据访问地址配置 HTTPS。宝塔 Nginx 将请求转发到 `http://127.0.0.1:3080`，访客通过 HTTPS 加入房间。

| 你的情况 | 教程 |
|---|---|
| 只有公网 IPv4 | [配置 Docker、申请 IP 证书并启用 HTTPS](docs/local-deployment/01-公网IP部署.md) |
| 需要逐项填写宝塔编排或更新已有容器 | [Docker 编排模板与操作步骤](docs/local-deployment/02-Docker编排模板.md) |
| 有域名 | [配置域名解析、宝塔证书和反向代理](docs/local-deployment/03-域名部署.md) |

## 下载镜像

Docker Hub 仓库为 [tunneluser/voice-room](https://hub.docker.com/r/tunneluser/voice-room)。镜像发布后，可运行 `docker pull tunneluser/voice-room:0.3.1` 拉取固定版本，或使用 `latest` 跟随最新稳定版。

服务器需要离线导入镜像时，下载对应版本的 Linux amd64 镜像包和 `SHA256SUMS`。以下命令校验并导入 0.3.1，再为它添加编排模板使用的标签。[GitHub Releases](https://github.com/adb-shell/Web/releases)

```bash
grep 'linux-amd64.tar.gz$' SHA256SUMS | sha256sum --check
docker load --input shengjian-voice-0.3.1-linux-amd64.tar.gz
docker tag shengjian-voice:0.3.1 tunneluser/voice-room:0.3.1
```
