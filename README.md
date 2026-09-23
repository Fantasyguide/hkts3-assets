# HKTS3 静态资源

活动谜题共用的私有资源仓库。代码继续留在原仓库；第一批是 Grill-The-Grid 的 20 张 WebP，共 325,708 字节。Grill-The-Grid 题目作者：**Aya Verstappen**。素材来自现有 GTG 题目，原始 PNG 留在题目仓库，不另行授予第三方素材许可。

唯一上传目录为 `public/`，包含内容哈希图片、`index.html`、`404.html` 和 `edgeone.json`。`manifest.json` 在上传目录外记录文件来源、大小、完整 SHA-256；不包含答案、题库或玩家信息。公开 CDN 不继承谜题开放时间，保密素材在可公开之前不要导入发布。

托管目标：腾讯云 EdgeOne Pages / Makers，**中国站账号、中国大陆加速区**，域名 `hkts3-assets.fantasyguide.cn`。域名需在控制台完成归属、备案、CNAME 与 HTTPS 验证。默认项目预览域名有有效期限制，不作为生产图片地址。当前上线状态见 [STATUS.md](STATUS.md)。

## 首次远程认证与发布

无需与 Codex 共用电脑，也不用开放 WSL 登录回调端口。

1. 在 [腾讯云 API Token 页](https://console.cloud.tencent.com/edgeone/pages?tab=api) 创建短期 Token。
2. 在本仓库 Settings → Secrets and variables → Actions 添加 `EDGEONE_PAGES_API_TOKEN`；不要写进文件、聊天或 Git。
3. 在 Actions 中手动运行 **Publish static assets**，分支选择 `main`。也可运行：

```sh
gh workflow run publish.yml --repo Fantasyguide/hkts3-assets --ref main
```

只允许手动触发，push 不触发发布。工作流校验资源、测试脚本、打包当前提交的 `public/`，使用固定版本官方 SDK 上传。首次创建时显式指定 `area: mainland`；后续核对项目名称和区域。它不购买套餐、不修改谜题服务器或域名 DNS。

第一次成功后，将工作流摘要里的项目 ID 填入 `deployment.json` 的 `projectId` 并提交。若项目已存在但没有绑定该 ID，脚本停止，避免误更新同名项目。首次创建成功但上传失败时，日志和制品中的部署记录也会留下 ID；先填写 ID 再重试。

Actions 制品保存 30 天，包含 `public.zip`、SHA-256、Git 提交和部署记录；需要更长留存时下载到自己的备份位置。固定提交仍可重新打包。Token 到期后只影响后续发布，不影响已上线图片。

## 后续换图或加入其他谜题

本机命令如下，其他电脑调整工作区路径。Node 使用 24.x；本 WSL 已安装在 `/opt/hkts3-runtime/bin/node`。

```sh
export PATH="/opt/hkts3-runtime/bin:$PATH"
cd /home/tonrac/code/bxtz3/riddle-platform
node scripts/export-images.mjs --puzzle Grill-The-Grid --output /tmp/hkts3-images-next

cd /home/tonrac/code/bxtz3/hkts3-assets
npm ci --ignore-scripts
node scripts/assets.mjs import /tmp/hkts3-images-next
node scripts/assets.mjs import /tmp/hkts3-images-next --apply
npm test
npm run check
git add manifest.json public
git commit -m 'Update puzzle images'
git push origin main
```

导出目录必须尚不存在。预览导入不写入文件，`--apply` 才追加资源；保留所有旧哈希，不覆盖同名图片、不删除旧版本。新增谜题必须明确指定 `--puzzle`，不会自动扫描和发布其他题目。Connections 当前没有需要导出的光栅图片。导出、导入、打包都不会上传；上传另行手动触发。

普通 UI、交互、题面文字继续在题目代码仓库修改，不必运行这里的流程。缓存、CSP、图片基地址及回退逻辑属于 `riddle-platform` 架构。

## 单独打包与验收

提交工作区后：

```sh
npm run pack
# 产物：dist/<Git完整提交>/public.zip 与 receipt.json
```

ZIP 根目录直接是 `index.html` 和图片目录，可在腾讯云选择“直接上传”。不要上传整个仓库。独立打包脚本拒绝未提交改动和覆盖已有制品。

域名和 HTTPS 配好后：

```sh
npm run verify:cdn
```

这只对专用 CDN 顺序请求清单中的图片和一次不存在的图片，核对正文哈希、类型、缓存头、跨源策略及 404；不访问 `riddle.fantasyguide.cn`，不执行压力测试。结果保存在 `dist/verify-*.json`。仍需大陆电信、移动、联通的实际玩家网络抽查，不能用 GitHub runner 或单一机器结果替代。

当前缓存为哈希图片一年 immutable；同名图片内容不得更改。入口不列出资源清单，没有 SPA 回退。CDN 响应头通过 EdgeOne 的 `edgeone.json` 设置，不能使用 Cloudflare `_headers`。

## 接入应用与回滚

先发布、验收资源，再单独部署对应平台和题目代码，最后将生产活动配置设置为：

```json
"imageBaseUrl": "https://hkts3-assets.fantasyguide.cn/"
```

原站继续保留同版本图片。准备好的前端在 CDN 错误或 6 秒超时后回退本站一次。此次资源发布本身不启用生产配置，也不更新生产应用。

应用回滚时使用原部署文档中的旧 release / activation，CDN 保留新旧图片即可，无需删除或倒退资源快照。CDN 故障时把 `imageBaseUrl` 改为 `null` 并按原配置激活流程部署。该配置不重置玩家状态。

若必须修复 CDN 配置，在最新资源集合上改配置并重新发布，保留所有历史图片；不要直接回滚到缺少新图片的旧快照。应急需要重新上传旧包时，可在 EdgeOne“新建部署”上传备份 `public.zip`，但必须先确认在线应用均不再引用较新的图片。

官方资料：[Direct Upload](https://pages.edgeone.ai/document/direct-upload)、[响应头](https://pages.edgeone.ai/document/edgeone-json)、[SDK](https://pages.edgeone.ai/document/sdk-overview)、[大陆区域](https://cloud.tencent.com/document/product/1552/138177)。
