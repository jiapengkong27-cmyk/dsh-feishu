# bridge（Windows）

DSH 与飞书之间的收发通道。全部是本机脚本，由一个每分钟运行的计划任务驱动。

## 三个脚本

| 文件 | 谁在跑 | 干什么 |
| --- | --- | --- |
| `setup.ps1` | 你，装一次 | 建目录、复制脚本、生成 `run-hidden.vbs`、注册计划任务 |
| `sender.ps1` | 计划任务，每分钟 | 保活 `lark-cli event consume`；把 `outbox/*.json` 发到飞书并删掉成功的 |
| `enqueue.ps1` | DSH 会话（agent） | 把要回复的文字排队到 `outbox/`，由 sender 在 1 分钟内发出 |
| `bridge.ps1` | DSH 会话（agent） | `pending` 取未处理消息、`mark <id>` 标记已处理、`drain` 全部标记、`status` 看概览 |

## 目录

```
<root>/
  sender.ps1  enqueue.ps1  bridge.ps1  run-hidden.vbs  config.json(可选)
  status.json       # sender 每次运行写的心跳，插件读它判断发送器健康
  sender.log        # 发送/保活日志
  consumer.out|err  # lark-cli 订阅进程的输出
  events/*.json     # 入站消息（lark-cli 写入）
  outbox/*.json     # 待发消息（enqueue 写入，sender 删除）
```

## 为什么用计划任务

`lark-cli event consume` 是一次性进程，掉线不会自愈。计划任务每分钟跑一次 `sender.ps1`，
顺手检查 `Active consumers`，没了就重新拉起；同时把队列里没发出去的消息补发。
这样"保活 + 发送重试"只需要一个机制，不需要常驻服务。

## 静默运行

`run-hidden.vbs` 用 `WScript.Shell.Run(..., 0, False)` 隐藏窗口启动 PowerShell，避免每分钟闪一次黑框。
它必须存成 **UTF-16**：路径里有中文时，ANSI 的 VBS 会读错文件名。

## 手动操作

```powershell
# 发一条
powershell -File enqueue.ps1 -ChatId oc_xxx -Text "你好"

# 看队列/事件
Get-ChildItem outbox, events -File

# 立刻跑一次（不用等计划任务）
powershell -File sender.ps1

# 停订阅
lark-cli event stop --force
```

## 已知限制

- 只在 Windows 上验证过（`schtasks` + `wscript`）。
- 断开期间飞书不会重投消息，`events/` 里没有那段时间的入站记录。
- `outbox` 里发送失败的消息会一直留着重试；确认坏掉的话手动删掉对应 json。