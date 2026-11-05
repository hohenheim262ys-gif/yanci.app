# 研词 · 考研英语一

手机优先的静态 PWA：查词、看英语一考频、义项、词根，积累生词本，每天读一篇包含你生词的英语一范文。

- **查词**：手动输入；支持词形（sustained → sustain）、拼写纠错、中文反查（如「维持」）。
- **词条**：英语一 2002–2026 共 25 套真题正文考频、全部义项、音标、词形、词根/词源、作文语料例句。
- **生词本**：查词自动加入（可在设置关掉）；按记忆曲线安排下次复现，不需要打分。
- **每日一篇**：从生词本选 3–5 个词；优先匹配 IKTNF 的 49 篇现成范文；配置 DeepSeek Key 后可按你的生词生成专属范文。
- **作文库**：Part A 16 类小作文整篇填空模板；Part B 3 套三段框架（图画/图表/观点）；28 套真题 + 49 篇范文；870 条主题语料；611 个词根。
- **离线**：首次打开后 Service Worker 缓存全部数据，断网可用；部署在云端，电脑关机不影响手机访问。
- **无账号、无后端、无统计脚本**；进度只存在本机，可导出/导入 JSON。

## 本地预览

最简单：

    python -m http.server 8765 --bind 127.0.0.1

然后打开 http://127.0.0.1:8765/ 。手机同一 Wi-Fi 下可用电脑局域网 IP 访问，但这只是测试；真正“电脑关机也能用”需要部署到云端。

## PDF 导入

入口：生词本页 → **PDF 导入**，或设置页 → PDF 导入。

1. 选文字版 PDF（≤50MB，最多处理前 200 页）。
2. 自动提取英文单词，按词形还原合并（sustained → sustain），统计出现次数。
3. 默认只选“新词”；可切换大纲/扩展/已在生词本/未收录，可搜索。
4. 点“加入生词本”。已在生词本里的词会跳过，保留原记忆曲线进度。
5. 导入后，这些词会参与之后的每日范文选词。

限制：只支持**文字版 PDF**；扫描件/图片 PDF 没有文字层，需要 OCR，当前不做。未收录词只展示，不写入生词本。PDF 不会上传服务器。

## 手机安装（PWA）

这是**可安装网页（PWA）**，不是应用商店 App，所以没有“下载安装包”按钮。

- **iPhone / iPad**：用 **Safari** 打开 → 底部分享 → **添加到主屏幕**。
- **Android**：用 Chrome/Edge 打开 → 右上角菜单 → **安装应用 / 添加到主屏幕**。
- **微信**：微信内置浏览器不能安装；点右上角 … → **在浏览器打开**，再按上面操作。
- 安装后有桌面图标、全屏打开、离线可用；数据和未安装时是同一份。

应用内：设置页 → 安装到手机，会按当前设备显示对应步骤。

## 部署到 GitHub Pages（免费，推荐）

1. 新建一个 GitHub 仓库（public 或 private 均可；private 的 Pages 需要 GitHub Pro）。
2. 把本目录所有文件上传/推送到仓库根目录（data-src/ 不必上传）。
3. 仓库 Settings → Pages → Build and deployment：
   - Source 选 **Deploy from a branch**
   - Branch 选 main，目录选 / (root)
4. 等 1 分钟，打开 https://你的用户名.github.io/仓库名/
5. 手机浏览器打开该地址：
   - iPhone Safari：分享 → 添加到主屏幕
   - Android Chrome：菜单 → 安装应用 / 添加到主屏幕

仓库里的 .nojekyll 用来避免 GitHub Pages 的 Jekyll 处理；404.html 是兜底页。

更新文件后，请把 sw.js 里的 CACHE 版本号加一（例如 yanci-v3 → yanci-v4），否则老用户可能继续读到缓存。

## 部署到 EdgeOne Pages（国内访问慢时备选）

1. 腾讯云 EdgeOne Pages 导入同一个仓库。
2. 构建命令留空，输出目录填 /（纯静态，无需构建）。
3. 用默认域名访问；自定义域名按腾讯云要求备案。

应用是纯静态文件，Cloudflare Pages、Netlify、Vercel 也可以直接部署，迁移成本很低。

## 可选：配置 DeepSeek Key

不填 Key 也能用：每天会从 49 篇现成范文里找一篇包含你生词的；匹配不到时会显示通用范文，并提示你配置 Key。

填 Key 后，应用会在浏览器里直接调用 DeepSeek API（已实测支持跨域），按你的生词生成 3 段式 Part B 或约 100 词的 Part A，并校验每个目标词都出现。

- 设置页 → AI 范文 → 填 Key → 保存 Key。
- Key 只存在本机 localStorage；导出备份不包含 Key。
- 一天一篇约几分钱；建议在 platform.deepseek.com 按量充值，不要在公共设备保存 Key。

## 重新生成数据

数据已经生成在 js/data/，日常使用不需要跑。想更新词库/作文语料时：

    node scripts/build-data.mjs

脚本会从 GitHub 下载并缓存到 data-src/，然后生成：

- js/data/words.js：9,395 词（大纲 5,501 + 扩展 3,894）
- js/data/essays.js：870 条语料 + 16 类模板 + 49 篇范文 + 3 套框架
- js/data/roots.js：611 个词根词缀
- js/data/meta.js：构建信息

需要 Node 18+（推荐 24），网络能访问 raw.githubusercontent.com。

如果重建时想保留全部音标，先把 ECDICT 的 ecdict.csv 放到 data-src/，再运行 python scripts/extract-ecdict.py，然后跑 build-data.mjs；不跑也能构建，只是少数基础词没有音标。

## 数据来源与许可

| 用途 | 来源 | 许可 |
|---|---|---|
| 英语一考频、5,501 大纲词表 | [npee-vocab-statistics](https://github.com/yikun-justcai/npee-vocab-statistics) | MIT |
| 音标、词形、词根 | [ECDICT](https://github.com/skywind3000/ECDICT) | MIT |
| 义项、词源、助记 | [JTKING27/kaoyan-vocab-context](https://github.com/JTKING27/kaoyan-vocab-context) | 代码 MIT；词卡数据 CC BY-SA 4.0 |
| 作文语料、模板、范文 | [IKTNF/kaoyan-english-writing-corpus](https://github.com/IKTNF/kaoyan-english-writing-corpus) | MIT |
| 全科词频、扩展词、变形 | [xiangjiawei1234-prog/kaoyan-vocab](https://github.com/xiangjiawei1234-prog/kaoyan-vocab) | MIT |
| PDF 文字提取 | [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 |

- 词卡数据来自 open-dictionary / 维基词典衍生数据，按 **CC BY-SA 4.0** 使用；如需再分发，请保留署名并以相同许可共享数据。
- 真题原文不随应用分发；考频是统计事实，例句来自 IKTNF 的原创语料。
- AI 生成的释义、词源、作文句仅供参考，请以权威词典和真题原文为准。
- 本项目仅用于个人学习，非官方产品。

## 目录

    index.html              应用入口
    css/app.css             样式
    js/app.js               交互逻辑（查词/生词本/每日范文/作文库/设置）
    js/data/*.js            构建产物（词库/作文/词根）
    data/frameworks.json    3 套大作文框架源文件
    scripts/build-data.mjs  数据构建
    scripts/make-icons.py   图标生成
    manifest.webmanifest    PWA 清单
    sw.js                   Service Worker（离线缓存）

## 已知取舍

- 不做拍照/OCR；PDF 也只支持文字版，扫描件需要 OCR。手动输入仍保留。
- 没有后端，所以“推送”是打开应用后的今日范文 + 首页提醒；真正锁屏推送需要额外的小后端（Web Push），当前未做。
- 不设打分/打卡/复习队列；记忆曲线只用于内部选词，词靠每天范文自然复现。
- 未配置 Key 时，现成范文只能覆盖部分生词；这是有意为之，避免硬编出不通顺的句子。
- 不打包 APK/IPA；PWA 添加到主屏幕即可。若以后确实要安卓安装包，再用 Capacitor/TWA 单独做。
