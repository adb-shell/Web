# 声间 · 网页语音房间

浏览器通过麦克风加入语音房间，支持六位房号、邀请链接、实时成员列表和静音。应用使用 Node.js、SQLite 和 Docker，部署所需的项目凭据在容器启动时通过环境变量提供。[部署与使用说明](voice-room/README.md)

## 下载镜像

Docker Hub 仓库为 [tunneluser/voice-room](https://hub.docker.com/r/tunneluser/voice-room)。镜像发布后，可运行 `docker pull tunneluser/voice-room:0.3.1` 拉取固定版本，或使用 `latest` 跟随最新稳定版。

在 [GitHub Releases](https://github.com/adb-shell/Web/releases) 下载对应版本的 Linux amd64 镜像包和 `SHA256SUMS`。以 0.3.1 为例，在下载目录执行：

```bash
grep 'linux-amd64.tar.gz$' SHA256SUMS | sha256sum --check
docker load --input shengjian-voice-0.3.1-linux-amd64.tar.gz
docker run -d --name voice-room --restart unless-stopped --env-file .env \
  -v voice-room-data:/app/data -p 127.0.0.1:3080:3080 shengjian-voice:0.3.1
```

## 发布版本

更新 `voice-room/package.json` 及锁文件的版本，提交后推送对应标签，如 `v0.3.1`。GitHub Actions 运行应用测试、构建容器并启动验证，然后向 Release 上传镜像、源码部署包及 SHA-256 校验文件。

发布到 Docker Hub 时，在仓库的 Actions 设置中添加变量 `DOCKERHUB_REPOSITORY`（公开仓库全名，例如 `your-id/voice-room`）和密钥 `DOCKERHUB_TOKEN`（具有推送权限的 Docker Hub 访问令牌）。组织仓库另设变量 `DOCKERHUB_USERNAME` 指定登录账号。工作流从已发布的 Release 下载镜像、校验并推送版本标签，再验证匿名拉取。当前最新 Release 同时发布 `latest`。

可以在 Actions 的 “Publish voice room” 中点击 “Run workflow”，选择 `main` 并填写原版本标签。已有的正式 Release 会复用原镜像。
