# HKTS3 静态资源

本仓库公开保存本次谜题活动允许分发的图片。游戏 UI、题面、答案、玩家进度和密钥留在各自代码仓库或生产服务器。

## 当前方案

玩家优先从 **JSDMirror** 下载固定提交中的图片；出错或 6 秒未完成时，题目前端改从本站下载同一张图片，回退一次。图片使用内容哈希文件名和浏览器缓存。网页及提交 API 始终由谜题服务器提供。

仓库结构：`public/<英文题名>/...` 保存图片；`manifest.json` 记录 SHA-256、大小及来源。当前为 Grill-The-Grid 的 20 张 WebP，共 325,708 字节。连接使用服务商域名，不需要自己的 CDN 子域名、DNS、云端项目或 API Token。[JSDMirror 文档](https://github.com/jsdmirror/www.jsdmirror.com)

## 导入与发布

使用 Node.js 24。此 WSL 先运行 `export PATH="/opt/hkts3-runtime/bin:$PATH"`。

```sh
# 在同级 riddle-platform 中导出本次允许公开的图片。
cd ../riddle-platform
node scripts/export-images.mjs --puzzle Grill-The-Grid --output dist/images-next
cd ../hkts3-assets
node scripts/assets.mjs import ../riddle-platform/dist/images-next
node scripts/assets.mjs import ../riddle-platform/dist/images-next --apply
npm ci --ignore-scripts
npm test
npm run check
# 审查后提交本次资源；不要覆盖或删除活动期间旧哈希图片。
git add public manifest.json
git commit -m 'Update puzzle images'
git push origin main
ASSET_COMMIT=$(git rev-parse HEAD)
node scripts/assets.mjs verify "$ASSET_COMMIT"
node scripts/assets.mjs base "$ASSET_COMMIT"
```

`verify` 逐张核对实际正文、SHA-256、图片类型、缓存和跨源策略，并检查缺失文件的 404。拒绝跳转到 GitHub Raw、错误页或其他域名。不是压力测试。需要代理的终端可设置 `NODE_USE_ENV_PROXY=1`，但代理速度不能作为大陆访问结论。也可手动运行 GitHub Actions 的 `Check static assets`。

最后把输出的基地址填入平台生产活动配置的 `imageBaseUrl`，按平台 DEPLOYMENT.md 打包、上传和激活。只推送资源仓库不会改变生产应用。正式地址格式：

```text
https://cdn.jsdmirror.com/gh/Fantasyguide/hkts3-assets@<完整40位提交>/public/
```

## 更新与回退

- 只改 UI、交互、题面：操作题目代码仓库并按平台发布流程部署，保持图片提交不变。
- 换图片：先压缩、导出、追加到此仓库并验证 CDN，再发布引用该版本的题目。固定提交基地址改变时，旧图片 URL 也会改变，故不要因纯文档或 UI 修改更新图片基地址。
- CDN 异常：平台配置将 `imageBaseUrl` 设为 `null`，激活后新页面全部使用本站；已打开页面保留自身自动回退。
- 整体回滚：使用平台记录的旧 activation 同时恢复代码与配置，签名密钥保持不变。保留旧 Git 提交与图片，不以删除 CDN 图片完成回滚。
- 离线备份：干净工作区运行 `npm run pack`，生成仅含图片的 ZIP 和 SHA-256 收据。

公开仓库的图片和历史可以被任何人获取，不能靠图片 URL 实现题目开放时间控制。需要保密的未来题目素材等到允许公开时再导入。工具中的单图 20 MiB、图片合计 50 MiB 是本项目的自定保护线，不是对镜像免费额度的承诺。
