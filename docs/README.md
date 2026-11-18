# docs/

| 文件 | 说明 |
|---|---|
| [方案-头像撑瓶.md](方案-头像撑瓶.md) | 玩法设计：互动映射、合成、物理、瓶压、节奏、取舍 |
| [publish-guide.md](publish-guide.md) | 发布到 GitHub 的步骤（截图、Release、仓库设置） |
| screenshots/ | README 用截图与 GIF（`?demo=1&shot=1` 拍摄，不含真实观众信息） |
| tools/ | 开发工具：截图、逐帧抓取、GIF 合成、打包发布 |

## 本地重新生成素材

```powershell
# 1. 起本地服务
python launch.py --server-only --port 8092

# 2. 截图（无头 Edge/Chrome + CDP，零依赖）
node docs/tools/devshot.mjs "http://127.0.0.1:8092/index.html?demo=1&shot=1" docs/screenshots/hero.png 3000 1920 1080

# 3. 逐帧抓取 + 合成 GIF（需要 Pillow）
node docs/tools/capture-frames.mjs "http://127.0.0.1:8092/index.html?demo=1&shot=1" docs/frames 46 70 26
python docs/tools/make-gif.py docs/frames docs/screenshots/demo.gif 600 13 48

# 4. 打包
python docs/tools/pack-release.py 1.0.0
```
