# 安装与排错

## 0. 前置检查

```powershell
node --version                 # DSH 用的是自带运行时，这台机器仅用于脚本
lark-cli auth status           # 机器人 + 用户身份都要 ready
lark-cli event status          # 应为 Bus: not running（桥接还没起）
dsh --version                  # 0.2.x
```

没有 lark-cli：`npm i -g @larksuite/cli`，然后 `lark-cli auth login`。

## 1. 装桥接

```powershell
powershell -ExecutionPolicy Bypass -File bridge\setup.ps1
# 可选参数：
#   -Root C:\path\to\feishu-bridge   桥接目录（默认 %DSH_HOME%\feishu-bridge）
#   -LarkCli <lark-cli.cmd 路径>     写进 <root>\config.json
#   -TaskName FeishuCLIBridgeSender  计划任务名（要和插件配置一致）
```

它会：建目录（`events/`、`outbox/`）→ 复制三个脚本 → 生成 UTF-16 的 `run-hidden.vbs` → 注册每分钟计划任务 → 打印任务状态。
**不会**动你的飞书授权，也不会删任何东西（`/Create /F` 只覆盖同名任务）。

装完手动跑一次，确认订阅能起来：

```powershell
powershell -ExecutionPolicy Bypass -File <root>\sender.ps1
# 期望输出：sender run: alive=True sent=0 failed=0
```

## 2. 装两个插件

```powershell
dsh plugin --profile desktop add link:D:\path\to\dsh-feishu\packages\dsh-feishu-observer
dsh plugin --profile desktop add link:D:\path\to\dsh-feishu\packages\dsh-feishu-board
```

（`desktop` 换成你的 profile 名。）

## 3. 配置

编辑**本机 profile** 的 `cordis.patch.yml`（`%DSH_HOME%\profiles\<profile>\cordis.patch.yml`）：

```yaml
- id: feishu-observer
  name: 'dsh-feishu-observer'
  config:
    chatId: oc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    chatLabel: 我的飞书
    larkCli: C:/Users/you/AppData/Roaming/npm/lark-cli.cmd
    bridgeDir: C:/Users/you/.dsh/feishu-bridge
    senderTask: FeishuCLIBridgeSender
    pauseSchedules:
      - 飞书值班台轮询        # 可选：断开时一起暂停的 DSH 定时任务
```

`chatId` 怎么拿：给机器人发一条消息，`<root>\events\*.json` 里就有 `chat_id`；
或者 `lark-cli im +chat-list --as bot --types=p2p`。

## 4. 验证

1. 刷新 DSH 页面 → 左栏出现飞书图标，标题栏出现「● 飞书」。
2. 点图标 → 看板 7 项检查应全绿。
3. 点「发送测试消息」→ 飞书收到一条。
4. 点「断开飞书连接」（两次确认）→ 胶囊/灯变空心灰，计划任务变 Disabled，`lark-cli event status` 显示 Bus: not running。
5. 点「恢复飞书连接」→ 恢复并收到一条「已恢复」通知。

## 排错

| 现象 | 检查 |
| --- | --- |
| 看板显示「找不到连接看板服务」 | observer 没装/没启用：`dsh plugin --profile <p> list` 里看 `feishu-observer` 行 |
| 「飞书授权」红 | `lark-cli auth login` 重新扫码；用户令牌 7 天不用会过期 |
| 「事件长连接」红 | 跑一次 `<root>\sender.ps1`，看 `sender.log` / `consumer.err` |
| 「桥接发送器」红 | 计划任务是否 Enabled；`status.json` 的 `time` 是否在刷新 |
| 检查全绿但飞书没收到消息 | `chatId` 对不对；机器人是否在该会话里；看 `outbox\` 是否有堆积（发送失败会留着重试） |
| 断开后看板又自己连上 | 有别的监控在复活它：确认没有第二个 observer 实例，且 `pauseSchedules` 没漏掉值班轮询任务 |
| 标题栏没有状态灯 | 需要打开一个会话（新会话首页只有左栏图标上的小圆点） |

## 卸载

```powershell
schtasks /Delete /TN FeishuCLIBridgeSender /F
lark-cli event stop --force        # 停掉订阅
dsh plugin --profile desktop remove dsh-feishu-board
dsh plugin --profile desktop remove dsh-feishu-observer
Remove-Item -Recurse <root>         # 桥接目录（含 events/outbox 历史）
```