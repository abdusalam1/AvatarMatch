# 发布指南

## 1. 本地自检

```powershell
node --test "match-*.test.mjs"
python test_launch_windows.py
```

两条都要全绿再继续。

## 2. 截图与 GIF

```powershell
python launch.py --server-only --port 8092
node docs/tools/devshot.mjs "http://127.0.0.1:8092/index.html?demo=1&shot=1" docs/screenshots/hero.png 3000 1920 1080
node docs/tools/capture-frames.mjs "http://127.0.0.1:8092/index.html?demo=1&shot=1" docs/frames 46 70 26
python docs/tools/make-gif.py docs/frames docs/screenshots/demo.gif 600 13 48
```

> 截图一律用 `?demo=1&shot=1`，不要出现真实观众昵称/头像。GIF 控制在 1.5MB 左右。

## 3. 打包

```powershell
python docs/tools/pack-release.py 1.0.0
```

产物：`dist/AvatarMatch-v1.0.0.zip`（含 `bridge/`、`.github/`、`requirements.txt`，不含
`.git/`、`dist/`、`docs/frames/`、WebView 配置目录、日志、缓存）。

解压到空目录后，再跑一遍两条测试，确认"不是在我机器上才能跑"。

## 4. 初始化 git 并推送

```powershell
cd D:\onedrive\OneDrive\桌面\order\AvatarMatch
git init -b main
git add -A
git commit -m "feat: 头像撑瓶 v1.0.0（抖音直播互动游戏）"
git remote add origin https://github.com/abdusalam1/AvatarMatch.git
git push -u origin main
```

## 5. GitHub 仓库设置

- Description：`抖音直播互动游戏：头像掉进瓶子，同一个人同尺寸合并变大，撑满就炸`（中文放这里）
- Topics（只能 ASCII）：`douyin` `live` `canvas` `game` `avatar` `interactive` `javascript` `python`
- Website 留空
- Release：`v1.0.0`，附 `dist/AvatarMatch-v1.0.0.zip`，正文直接贴 CHANGELOG 的 1.0.0 段

## 6. 发版前清单

- [ ] 两条测试全绿
- [ ] `?demo=1` 能玩、无控制台报错
- [ ] 真实直播间能连上（自测房间）
- [ ] 退出程序后没有残留 node / 直播间窗口
- [ ] README 图片链接有效，GIF ≤2MB
- [ ] bridge/LICENSE 与出处还在
- [ ] 作者信息、License、Topics 就位
