# ZEGO 网页纯语音通话接入笔记

核对日期为 2026 年 11 月 18 日。ZEGO Express Web SDK 提供麦克风采集、语音传输和播放能力，业务后端负责识别用户、授权和签发 Token。部署本项目时，在服务器的 `compose.yaml` 中填写 AppID 和 ServerSecret，再用两台设备进房验证通话。[宝塔编排及凭据填写](local-deployment/02-Docker编排模板.md) · [实时语音 Web 文档](https://doc-zh.zego.im/real-time-voice-web/introduction/entry)

## 文档覆盖

官方站点地图共有 6,501 个不同地址，包含 6,496 个文档地址和 5 个搜索入口。项目内的索引每行记录一个文档标题和官方链接，可用中文标题、产品名或路径直接搜索。全站按官方源码与线上文档建立索引，技术核对集中在 Web 实时语音的 47 页、实时语音服务端的 78 页，以及相关的浏览器与呼叫邀请指引。[项目文档索引](./zego-doc-index.jsonl) · [官方站点地图](https://doc-zh.zego.im/sitemap.xml) · [本次核对的官方源码快照](https://github.com/ZEGOCLOUD/docs_all/tree/ba8d84308fd2e033a5a0fa3b500f46a6fd482ea9)

有三个站点地图地址的线上正文显示转换失败，分别是 iOS 和 macOS 的 Swift 实时语音 Interface，以及 iOS 互动直播 UIKit 的 v3.0 迁移页。索引保留了原地址与同平台相关源码，便于复查。

## 从点击通话到听见对方

| 时机 | 网页或后端的动作 | 如何判断结果 |
| --- | --- | --- |
| 打开通话页 | 使用 HTTPS，本机开发可用 localhost。初始化引擎后，先监听房间、流和 Token 事件。纯语音可用 `checkSystemRequirements("webRTC")` 单独检测 WebRTC。 | 页面打开时即可判断浏览器能否建立实时连接。 |
| 用户点击加入或接听 | 后端按已登录的业务用户和通话成员关系签发 Token。双方使用相同的 `roomID` 和各自的 `userID` 调用 `loginRoom`。 | 以房间连接成功为准。若界面需要展示人员进出，登录时传入 `userUpdate: true`。 |
| 开始说话 | 调用 `createZegoStream({ camera: { audio: true, video: false } })` 创建本地流，再用 `startPublishingStream` 发布。每条流的 `streamID` 在整个 AppID 内唯一。 | 浏览器只请求麦克风。发布状态由 `publisherStateUpdate` 跟踪。 |
| 对方开始说话 | 在 `roomStreamUpdate` 的 `ADD` 事件中逐条处理远端流。调用 `startPlayingStream(streamID)`，把返回的媒体流交给 `<audio>`。 | 区分拉流成功和浏览器允许出声。播放受限时显示“点击开启声音”，在点击事件中恢复播放。 |
| 静音或恢复 | 本人发言开关使用 `muteMicrophone(true/false)`。如需选择输入设备，可用 `getMicrophones` 和 `useAudioDevice`。 | 用对端是否能听见验证静音，同时确认本端仍能听见对方。 |
| 对方离开或本人挂断 | 收到流 `DELETE` 时停止对应拉流。本人挂断时停止发布、销毁本地流、停止剩余拉流、解绑播放器并退出房间。完全离开通话功能时销毁引擎。 | 浏览器结束麦克风采集，再次呼叫时只建立一组流和事件监听。 |

官网集成指南示例使用 npm 包 `zego-express-engine-webrtc`。本次核对的 Web 发布日志列出 3.13.0。开发时应锁定实际使用的版本，按该版本的类型定义核对签名。纯语音页面可以直接播放远端音频，本地正常通话默认关闭麦克风回放，以免用户听到自己的声音。[集成 SDK](https://doc-zh.zego.im/real-time-voice-web/quick-start/integrating-sdk) · [实现音频通话](https://doc-zh.zego.im/real-time-voice-web/quick-start/implementing-voice-call) · [客户端 API](https://doc-zh.zego.im/real-time-voice-web/client-sdk/api-reference/function-list) · [发布日志](https://doc-zh.zego.im/real-time-voice-web/client-sdk/release-notes)

## 身份、房间与来电

- **身份与权限。** 正式环境由业务后端使用 AppID 和 ServerSecret 生成 Token04，网页只接收签发结果。签发时的 `userID` 须与登录房间的 `userID` 一致。基础鉴权默认开通。若要让 ZEGO 强制校验指定房间或推流 ID 的权限，官方要求联系技术支持开通权限认证 Token。[Token 鉴权](https://doc-zh.zego.im/real-time-voice-web/communication/using-token-authentication)
- **续期。** 官方给出的 `tokenWillExpire` 通知时间是到期前 30 秒。收到事件后向业务后端申请新 Token，再调用 `renewToken`。长通话验收应跨过至少一个续期点。[Token 鉴权](https://doc-zh.zego.im/real-time-voice-web/communication/using-token-authentication)
- **呼叫方式。** 双方通过链接或房间号加入时，Express 即可承载通话。如果要“点联系人拨打，对方收到来电”，可用 ZIM 的邀请、接受、拒绝、取消和超时事件协调双方，再用 Express 传送声音。房间内消息的接收范围限于该房间。如果后续选用现成界面，Web 通话 UIKit 也提供纯语音配置。[房间消息](https://doc-zh.zego.im/real-time-voice-web/room/messaging-and-signaling) · [Web 呼叫邀请](https://doc-zh.zego.im/zim-web/guides/call-invitation-signaling) · [UIKit 纯语音配置](https://doc-zh.zego.im/callkit-web/custom-prebuilt-features/implement-an-audio-only-session)
- **业务后台。** 需要后台核对参会者或排查单向无声时，可查询房间用户、流列表和 RTC 流状态。若保存进退房或流创建、销毁回调，后端应验签并去重，官方服务会重试投递。[服务端 API 总览](https://doc-zh.zego.im/real-time-voice-server/api-reference/overview) · [回调配置](https://doc-zh.zego.im/real-time-voice-server/callback/receiving-callback)

## 通话异常的判断顺序

| 现象 | 优先检查 |
| --- | --- |
| 麦克风无权限或被占用 | 检查 HTTPS、系统授权、站点授权及当前输入设备。官方错误码中 `1103064` 对应设备权限，`1103065` 表示设备无法采集，可能被占用。 |
| 已显示进房，对方听不到 | 依次查本端麦克风与静音状态、推流状态、对端是否收到流新增、拉流状态、远端播放器是否获准出声。 |
| 网络切换后声音中断 | 用 `roomStateChanged` 区分重连中、重连成功、重连失败和被踢。SDK 正在自动重连时保留当前通话，避免重复登录或发布。 |
| 时断时续或只有一方音质差 | 对照发送端 `publishQualityUpdate` 与接收端 `playQualityUpdate` 的音频码率、丢包率和时间点。记录房间、流、SDK 版本与错误码，便于复现。 |
| 桌面能听见，手机没有声音 | 单独验证 iOS Safari 和目标内置浏览器的播放恢复操作。设备列表、扬声器选择等能力也受浏览器限制。 |

相关细节见[常见错误码](https://doc-zh.zego.im/real-time-voice-web/client-sdk/error-code)、[房间连接状态](https://doc-zh.zego.im/real-time-voice-web/room/room-connection-status)、[质量监测](https://doc-zh.zego.im/real-time-voice-web/communication/monitor-stream-quality)、[自动播放策略](https://doc-zh.zego.im/real-time-video-web/best-practice/autoplay-policy)和[浏览器兼容性](https://doc-zh.zego.im/real-time-video-web/introduction/browser-restrictions)。

## 双端验收与用量

以两台设备、两个不同用户加入同一房间作为基础验收。分别验证双方能同时说话、静音只影响本人发言、拒绝麦克风后能恢复、首次播放受限时能手动开启声音。随后验证网络中断与恢复、Token 续期、挂断后麦克风释放以及重新拨打。若产品包含来电邀请，再验证拒接、取消和无人接听。[官方联调流程](https://doc-zh.zego.im/real-time-voice-web/quick-start/implementing-voice-call) · [呼叫邀请](https://doc-zh.zego.im/zim-web/guides/call-invitation-signaling)

ZEGO 按各用户实际拉取音频流的时长累计用量。例如，两人连续互听 10 分钟，对应 20 分钟纯音频拉流用量。对方离开后及时停止拉流，既能释放播放器，也有助于按实际使用核对账单。[实时语音计费说明](https://doc-zh.zego.im/real-time-voice-web/introduction/pricing/rtc)
