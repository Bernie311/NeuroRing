# Windows 免安装版隔离验收

日期：2026-10-23（Asia/Shanghai）。版本：`0.1.0-preview.1`。

**结论：下列独立 Windows 虚拟机验收全部通过。**

- [成功的 GitHub Actions 运行](https://github.com/Bernie311/NeuroRing/actions/runs/39954631769)
- [本次验收源码](https://github.com/Bernie311/NeuroRing/commit/c7167832d3993080d2af091b2bd83cd53182e9ec)
- [下载包、校验文件及永久保留的验收附件](https://github.com/Bernie311/NeuroRing/releases/tag/v0.1.0-preview.1)

## 验收对象与环境

测试直接解压最终发行 ZIP；发布使用同一文件，不重新压缩。文件大小为 9,746,610 字节。

```text
文件：NeuroRing-Windows-x64.zip
SHA-256：10903b2c1c79c70df710a676a08c26858882245d5d66fa8ad8e3d65c1e2e06e2
```

环境为 GitHub 托管的全新 Windows Server 2025 Datacenter x64 虚拟机，系统区域设置 `en-US`，镜像 `win25-vs2026 / 20261021.278.1`。
GitHub 为常规托管任务创建新的虚拟机，见 [官方运行器说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

在虚拟机内新建普通 Windows 用户，使用其独立用户目录运行程序。安装目录包含中文和空格，且对该用户只有读取和执行权限。
该用户没有 Codex 数据；运行应用时 PATH 只保留 Windows 系统目录，无法调用 Python、Node.js 或 Git。
运行器本身预装的开发工具仅用于前置源码检查和生成虚构测试数据，应用进程已确认加载包内 `_internal/python311.dll`。

## 通过的检查

- 27 项 Python 回归检查、5 项 JavaScript 回归检查。
- 同时启动和重复启动只保留一个服务；端口被占用时自动避让。
- 应用从只读的中文目录运行，将日志和服务记录写入当前用户的应用数据目录。
- 没有 Codex 时返回首次使用引导，且不创建 Codex 数据库。
- 9 项页面及静态资源可访问；跨站 API 请求被拒绝。
- 损坏的数据库显示不兼容状态；替换为兼容的虚构数据后自动恢复。
- 3 条虚构任务在实时连接缺失时保持未同步或状态未知，不被标为正在运行；数据库摘要不变。
- Edge 实际渲染整包页面与虚构任务，生成 1366 × 768 截图。
- 无管理员权限创建桌面快捷方式；停止服务后，通过该快捷方式实际启动中文路径下的正确 EXE。
- 普通 EXE 入口成功请求默认浏览器打开页面，并复用服务。
- 停止操作退出本服务，同时保持另一程序占用的端口可用。
- 损坏的服务记录可恢复；重新启动与再次停止成功。

## 隔离测试发现并修复的问题

英文 Windows 的旧脚本快捷方式接口会损失中文目标路径。最终版本改用 Windows 原生 `IShellLinkW` 接口。
上述快捷方式验收实际经过停止、通过快捷方式启动、核对新进程路径，不只检查文件是否存在。

## 证据与边界

Release 的 `NeuroRing-isolated-evidence.zip` 包含 `report.json`、`runner.json`、测试输出和实际浏览器截图。
截图中的项目与任务均为明确命名的虚构数据；发行包不包含这些测试数据或维护者的个人配置、数据库、聊天和日志。
Actions 临时附件保留 14 天，Release 附件保留本次报告副本。

Windows 11 x64 维护者本机的先前验证见 [PORTABLE_VALIDATION.md](PORTABLE_VALIDATION.md)。Windows 10、ARM64、其他 Codex 版本及实际下载信誉提示仍未验证。
本包未作 Windows 代码签名。此云端环境没有真实 Codex 桌面连接，因此真实连接的记录来自先前本机验证，不能据此推断所有 Codex 版本兼容。

ZIP 内的 `验证说明.md` 保留首轮本机验证快照，最新隔离验收以本文及 Release 附件为准。
后续可在仓库 Actions 页面手动运行 `Isolated Windows portable acceptance`，重新下载并按相同摘要验证发行包。

