# dsh-feishu

把飞书接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）：一个连接看板、一个侧栏入口、一颗随时能拔的插头。

## 它由三部分组成

| 部分 | 作用 |
| --- | --- |
| `packages/dsh-feishu-observer` | **引擎**。定时检查 lark-cli / 授权 / 事件长连接 / 桥接发送器 / 开放平台接口 / 消息入站，断线自动排查修复；启动、手动断开、手动恢复、中断时向飞书发通知。可选右下角浮窗胶囊。 |
| `packages/dsh-feishu-board` | **界面**。左侧栏一个飞书图标 → 整页看板；会话标题栏一颗常驻状态灯（绿/黄/红/空心灰），点一下跳到看板。 |
| `bridge/` | **Windows 桥接**。计划任务每分钟跑一次 `sender.ps1`：维持 `lark-cli event consume` 订阅、把 `outbox/` 里排队的回复发出去。 |

```
飞书用户 ──▶ 事件长连接(lark-cli event consume) ──▶ bridge/events/*.json ──▶ DSH 会话处理
                                                                              │
飞书用户 ◀── 开放平台 im/v1/messages ◀── lark-cli ◀── bridge/outbox/*.json ◀──┘（enqueue.ps1 排队）
                        ▲
                        └── dsh-feishu-observer：状态检测 / 通知 / 手动断联
                               ▲
                               └── dsh-feishu-board：看板 + 侧栏与标题栏指示灯
```

## 目录结构

```
dsh-feishu/
├─ packages/
│  ├─ dsh-feishu-observer/   引擎：检查 / 自检修复 / 通知 / 可选浮窗
│  │  ├─ index.js            宿主半边：HTTP 路由、计划任务、lark-cli 调用
│  │  ├─ client.js           浏览器半边：状态胶囊与详情面板
│  │  ├─ cordis.patch.yml    bundle 挂载声明（不含个人配置）
│  │  ├─ locale/  icon.svg  docs/  scripts/
│  └─ dsh-feishu-board/      界面：左侧栏看板 + 标题栏状态灯
├─ bridge/                   Windows 桥接：setup / sender / enqueue / bridge
├─ docs/install.md           安装、配置、排错
├─ scripts/publish.ps1       建仓库并推送（有 gh 用 gh，没有就打印手动步骤）
├─ README.md  LICENSE
```

## 依赖

- **Windows 10/11**：桥接依赖计划任务、`schtasks`、`wscript`；插件本身在其它平台能跑，但没有收发桥接。
- **DSH 0.2.x**：`dsh plugin` 用来 link 安装。
- **lark-cli**：`npm i -g @larksuite/cli`，并完成 `lark-cli auth login`（机器人 + 用户身份都要 ready）。
- **Node.js 18+**：只用于跑仓库里的 smoke 脚本；DSH 本身用自带运行时。

## 能做什么

- **一眼看到通不通**：标题栏「● 飞书」常驻，绿=已连接、黄=部分异常、红=中断（呼吸闪烁）、空心灰=已手动断开/未知；左栏图标右下角也有同色小点。
- **一键断开**：用不上的时候点「断开飞书连接」（两次确认），立刻停计划任务、杀订阅进程、停事件总线、暂停相关 DSH 定时任务。断开状态跨重启保留，看板不会自己把链路救回来。
- **一键恢复**：反向执行并复查，订阅恢复后立刻发一条飞书通知（含断开时长与检查结果）。
- **自动修复**：断线时探测网络 → 重启桥接订阅 → 复查，逐步结果留在看板上。
- **启动通知**：DSH 启动时向飞书发一条「已上线」。

## 安装与快速开始

依赖见上一节。三步装好：

```powershell
git clone https://github.com/jiapengkong27-cmyk/dsh-feishu.git
cd dsh-feishu

# 1) 装桥接（默认装到 %DSH_HOME%\feishu-bridge，注册每分钟计划任务）
powershell -ExecutionPolicy Bypass -File bridge\setup.ps1

# 2) 装两个插件（link 到当前 profile，改代码即时生效）
dsh plugin --profile <profile> add link:<绝对路径>\packages\dsh-feishu-observer
dsh plugin --profile <profile> add link:<绝对路径>\packages\dsh-feishu-board
```

3) 把下面这段写进 **本机 profile 的 `cordis.patch.yml`**（不是仓库里的那份，避免把个人会话 id 提交上去）：

```yaml
- id: feishu-observer
  name: 'dsh-feishu-observer'
  config:
    chatId: oc_你的会话id
    chatLabel: 我的飞书
    larkCli: C:/Users/你/AppData/Roaming/npm/lark-cli.cmd   # 已在 PATH 可省略
    bridgeDir: C:/Users/你/.dsh/feishu-bridge               # 与 setup.ps1 的输出一致
    pauseSchedules: []                                      # 断开时要一起暂停的 DSH 定时任务标题前缀
```

4) 刷新 DSH 页面。左栏出现飞书图标、标题栏出现「● 飞书」即成功。

详细步骤、目录含义、排错见 [docs/install.md](docs/install.md)。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `chatId` | `''` | 接收通知的飞书会话。留空则所有通知静默，检测与断开/恢复照常 |
| `chatLabel` | `''` | 看板里显示的名字，留空回退到 chatId |
| `larkCli` | `''` | lark-cli 入口；留空从 PATH 找 `lark-cli.cmd` / `lark-cli` |
| `bridgeDir` | `''` | 桥接目录；留空为 `<DSH_HOME>/feishu-bridge` |
| `senderTask` | `FeishuCLIBridgeSender` | 断开时停用、恢复时启用的计划任务名 |
| `pauseSchedules` | `[]` | 断开时一并暂停的 DSH 定时任务（标题前缀匹配） |
| `pollSeconds` | `30` | 检测间隔 |
| `showCapsule` | `true` | 是否显示右下角浮窗胶囊（装了 board 可以关掉） |
| `notifyOnStart` / `notifyOnBreak` / `notifyOnRecover` | `true` | 启动 / 中断 / 恢复通知 |
| `notifyOnDisconnect` / `notifyOnReconnect` | `true` | 手动断开 / 恢复通知 |

## 安全与隐私

- 全部在本机运行：插件只读本机 `lark-cli` 与本机文件，不经过任何第三方服务器；看板接口是绑定回环地址的同源路由。
- 桥接以你的 Windows 账号运行计划任务，权限就是你的账号权限。
- 仓库里不含任何会话 id、路径或凭据；`bridge/config.json`、`state.json`、`events/`、`outbox/` 都在 `.gitignore` 里。

## 已知限制

- **仅 Windows**：桥接依赖计划任务、`schtasks` 与 `wscript`。插件本身（检测 + 看板）在其它平台可以跑，但没有收发桥接。
- 断开期间的飞书消息**不会补发**（飞书不重投）。
- 发送使用机器人身份；如需以“你本人”身份发消息，要额外授权 `im:message.send_as_user`。
- 插件未发布到 npm，请用 `link:` 安装。

## 开发

```powershell
node packages\dsh-feishu-observer\scripts\smoke-client.mjs   # 胶囊 / 指示灯渲染
node packages\dsh-feishu-observer\scripts\smoke-host.mjs     # 宿主半边：路由与未配置态
node packages\dsh-feishu-board\scripts\smoke-client.mjs      # 看板 / 侧栏 / 标题栏
```

改 `client.js` / `index.js` 后刷新 DSH 页面即可；宿主半边改动需要重载插件。

## English

A Windows-first Feishu bridge for DeepSeek Harness, in three parts: `dsh-feishu-observer` (engine: checks, auto-repair, notices, optional capsule), `dsh-feishu-board` (left-sidebar board plus an always-on header status dot), and `bridge/` (a scheduled task that keeps `lark-cli event consume` alive and flushes replies queued in `outbox/`). One-click disconnect tears the whole link down and survives restarts; reconnect brings it back and posts a summary. See [docs/install.md](docs/install.md).

## License

MIT — see [LICENSE](LICENSE).