# NeuroRing Windows 免安装版

本候选版基于公开仓库提交 `111a194`，新增自带运行环境、独立服务管理、桌面快捷方式与首次启动提示。原有视觉设计保留。

## 使用

1. 把 `NeuroRing-Windows-x64.zip` **完整解压**到一个固定文件夹。
2. 双击 `NeuroRing.exe`，默认浏览器会自动打开大屏。
3. 查看真实数据需要同一 Windows 账号下的 Codex 桌面版。首次使用请打开 Codex、登录并创建一条聊天。

无需安装 Python、Node.js 或 Git，无需管理员权限。不要只拷贝 EXE，必须保留旁边的 `_internal` 文件夹。
程序不注册开机启动，不发起模型请求。应用本身使用本机连接，不需要下载前端资源。

关闭网页不会停止后台服务。使用 `停止 NeuroRing.cmd` 停止本副本，再次双击 EXE 即可重新启动。
可选：双击 `创建桌面快捷方式.cmd`，生成 `NeuroRing Portable` 桌面入口。以后移动文件夹后，再运行一次更新快捷方式。
这个入口与源码版的 `NeuroRing` 快捷方式分开，重复创建会更新 `NeuroRing Portable` 的目标位置。

## 首次使用与排查

- 没有 Codex 数据：页面显示引导并自动重试，不会生成虚构任务。
- Codex 未运行：仍可读取兼容的本地记录，实时状态显示未连接或待确认。
- Codex 数据或协议版本不兼容：页面明确提示；重新下载兼容版本后再试。
- 重复启动：同一解压目录复用一个后台服务；不同副本相互独立。
- 端口占用或被系统保留：自动选择其他本机端口，请用 EXE 打开页面。
- 日志与端口记录：`%LOCALAPPDATA%\NeuroRing\<本副本标识>\`。更新目录中的文件前请先停止服务。
- 自定义 Codex 目录：支持 `CODEX_HOME`，也可用 `NEURORING_CODEX_HOME` 指定只供本应用读取的目录。
- 卸载：先停止服务，再删除解压文件夹和自行创建的桌面快捷方式。

仅监听 `127.0.0.1`，以只读方式读取当前用户的 Codex 数据；不会携带作者的个人目录、聊天、数据库或日志。
实时状态最多覆盖最近 8 条聊天，事件最多读取最近 120 条聊天。普通云端 ChatGPT 聊天未接入。
内部数据格式随 Codex 版本变化；“程序可启动”和“兼容你的 Codex 版本”是两项不同的验证。

目标：Windows 10/11 x64。维护者本机验证结果见随包 `验证说明.md`；全新电脑、Windows 10 和 ARM64 未验证。
此试用包未签署 Windows 代码签名；系统是否显示下载信誉提示，需要在实际下载环境验收。

## 维护者构建

在 Windows x64 的 Python 3.11+ 环境运行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
node --test tests/task-band.test.cjs
.\.venv\Scripts\python.exe packaging\build_windows.py --output dist
```

构建工具会把运行环境、网页、许可证和启动说明一起打包，并输出 ZIP 与 SHA-256 校验文件。
只使用明确列出的文件；不会把工作目录、个人配置或数据库收进发行包。
源码与本机运行版分开维护。不要把 `catalog.json`、日志、数据库或测试用数据打包给别人。

采用 PyInstaller 文件夹模式：https://pyinstaller.org/en/stable/operating-mode.html
运行资源路径说明：https://pyinstaller.org/en/stable/runtime-information.html

原项目许可、商用授权与署名继续适用，详见 `LICENSE` 和 `NOTICE.md`。
