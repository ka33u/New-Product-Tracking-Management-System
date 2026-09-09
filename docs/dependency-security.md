# 本地依赖安全评估

核对日期：2026-09-07。结论：**不能通过升级到vinext 1.0.0-beta.9就宣称高等级风险已修复。保留vinext 0.0.50，已增加构建期格式禁用缓解，但依赖告警仍未关闭。**

## 迁移工具依赖修复（当前：0中等、2高）

公开公告列出esbuild ≤0.24.2的开发服务器跨站读取问题，修复版本为0.25.0。[上游公告](https://github.com/advisories/GHSA-67mh-4wv8-2f99)、[0.25.0发布说明](https://github.com/evanw/esbuild/releases/tag/v0.25.0)。本项目原来只有 `@esbuild-kit/core-utils` 内嵌依赖分支仍使用0.18.20；Drizzle Kit自己的esbuild已为0.25.12，Vite/Wrangler为0.28.1。

采用针对 `@esbuild-kit/core-utils` 的npm override，将其esbuild固定到已使用的0.25.12。不降级或升级Drizzle Kit，不全局替换其他esbuild，不抑制审计项。原helper声明的范围是~0.18.20，因此这是经本项目兼容性验证的覆盖，不冒充helper上游已声明支持；未来更新仍须重跑兼容性测试。

- `/private/tmp/hengda-migration-deps-qyjHoL` 独立副本仅含程序、测试与依赖，没有现有D1/R2、环境密钥或备份。离线安装并禁用安装脚本，只更新2个实际安装包；锁文件27条变化全部在该helper的esbuild及其平台二进制分支，其余包版本不变。
- 新增默认 `npm run test:migration-tooling`：检查helper实际解析到的编译器版本，执行同步/异步TypeScript转译及源码映射，然后在全新临时目录使用实际Drizzle CLI生成迁移。29表当前结构生成无变化，SQL/元数据历史全部字节保持；合成新增字段只生成一条常量默认值ALTER，历史journal只追加，内存SQLite执行后旧项目/人员/客户和其他表保持原值，重复生成无变化、完整性和外键检查通过。旧0.18.20与新0.25.12都通过同一兼容样本。没有对真实业务库重放旧迁移。
- CLI配置使用与本项目一致的相对out路径；早期测试夹具的绝对out路径触发了工具既有路径问题，而且CLI返回0。测试因此同时检查真实成功文本和生成内容，不只看进程退出码；未改写上游工具源码或把该次失败当成通过。
- 副本完整npm test、TypeScript、完整HTTP、真实D1空库初始化/重启及事务回归通过。最终封存 `20260907T004244Z-efeaf8e9a302` 的HTTP再次通过。业务app/db/scripts/drizzle目录与工作区保持相同；没有生成真实0010迁移或修改已应用迁移。
- 本地更新前备份 `backups/hengda-2026-09-07T00-46-40-895Z-Lt9Lik`。预先完整复制并逐目录核对候选依赖，停用服务后将旧node_modules保留到 `.local-releases/.runtime-backup-JO2HLw/node_modules`，同时保留原package.json/锁文件；再同步两份清单、切换已验证依赖和固定版本，并恢复服务。没有在运行中安装依赖或删除旧环境。
- 更新后实际helper版本0.25.12；根目录完整npm test、类型及定向lint通过，服务running/首页200，17张npd表全部字段与备份相同，quick_check正常、外键错误0。旧恢复副本仍包含旧包，不在当前运行依赖图中；恢复时必须配对旧清单并重新评估风险，不能绕过固定版本校验。

公开报告：隔离候选UTC `2026-09-07T00:35:56.528Z`、本地启用后UTC `2026-09-07T00:49:24.470Z` 均为0中等、2高、0严重；仅剩image-size和受其影响的vinext，`requiresAttention=true`。这证明对应旧分支告警已从当前依赖图消除，不是整个系统无漏洞或机器上不存在旧恢复包的证明。

## 已采用的构建期缓解

采用上游公开的 [disableTypes 接口](https://github.com/image-size/image-size#disabling-certain-image-types)，在实际Vite配置函数、框架插件创建之前禁用 `icns`、`heif`、`jxl`、`jxl-stream`。HEIF处理器同时涵盖HEIC和AVIF。将已存在的image-size 2.0.2显式声明为开发依赖，便于维护这项直接使用；没有下载新版本、替换已安装包或改写node_modules。不能把“仍安装受影响版本但限制调用”描述成上游修复。

- 隔离副本 `/private/tmp/hengda-parser-mitigation-QfmZrT` 不含业务库、R2、备份或环境密钥。仅新增配置调用和直接依赖声明，依赖锁的变化只是一行顶层声明，全部实际包版本不变。
- `npm run test:image-policy-runtime` 已纳入默认npm test：受限子进程加载实际Vite配置，然后调用Vinext真实图片导入插件与元数据生成函数。PNG/SVG正常1×1，ICNS、HEIF/HEIC/AVIF、JXL容器及裸码流共6种样本不进入被禁用的尺寸计算器；所有文件故意使用.png后缀，证明不是仅靠扩展名判断。子进程有20秒和192MiB堆上限；不向HTTP服务或业务附件目录发送样本。
- 禁用发生在格式识别之后、尺寸计算之前。检查当前版本的HEIF/JXL识别函数及findBox，相关查找循环会按正长度或8字节推进；本结论不是任意输入、所有其他图片解析器或完整CPU/内存上限证明。
- `tests/image-policy-build.mjs <隔离副本>` 只接受指定前缀的临时副本，创建一个不存在的临时app/icon.png并在结束时清理。真实构建因 `disabled file type: icns` 主动失败，未超时；该失败构建不部署。移除合成图标后重新完整构建、测试及隔离HTTP验收通过，再封存固定版本 `20260907T001644Z-8155d24cc39e`。原件没有进入实际项目。
- 普通静态图片导入的Vinext既有catch会返回0×0，而元数据图片路径会明确使构建失败。因此这不是全文件类型上传拦截器；后续程序素材请使用受支持的PNG/JPEG/SVG等格式，不依赖HEIF/JXL静态导入自动尺寸。本系统现有业务界面不使用这些被禁用格式。
- R2上传/下载、Word/Excel/ZIP归档规则和业务源码不改；隔离HTTP账户/项目/权限、三份合成原件逐字节下载与归档回归通过。这不等于对所有附件格式做了解码安全审计。运行时图片优化器和构建解析器也不是同一条调用路径，不能相互替代验证。

更新前成套备份：`backups/hengda-2026-09-07T00-19-38-176Z-2022uO`。切换后本地首页200、托管服务running，17张npd表所有字段与备份相同。根目录完整npm test、TypeScript与定向ESLint也通过。直接依赖声明使锁摘要改变，旧封存版本仍需匹配其原锁文件才能恢复，不能绕过固定版本校验。

公开复查UTC `2026-09-07T00:23:13.866Z` 仍为4中等、2高、0严重、共6个受影响包，`requiresAttention=true`；新增保护没有抑制审计项。两个上游公告当前仍列Patched versions为None。剩余依赖、未覆盖路径和正式验收边界仍需继续处理。

## 为什么拒绝直接升级

GitHub已审阅公告将image-size 2.0.2及以前版本列为受影响版本：特制ICNS输入可能使解析循环无法前进；另一公告涉及JXL/HEIF。核对时两个公告均未列出修复版本。[ICNS公告](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)、[JXL/HEIF公告](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)。

官方npm元数据中，vinext 1.0.0-beta.9不再声明image-size依赖；但实际安装文件包含 `dist/deps/.pnpm/image-size@2.0.2/deps/image-size/dist/index.js`，并由构建期元数据读取和Worker图片导入插件引用。因此“npm不再列出该依赖”不等于“危险解析代码已删除”。

| 核对对象 | npm依赖图报告 | 内嵌代码补查 |
| --- | --- | --- |
| 当前vinext 0.0.50 | 4中等、2高、0严重 | image-size作为正常依赖已计入，不重复计数 |
| 隔离候选vinext 1.0.0-beta.9 | 4中等、0高、0严重 | 另发现内嵌image-size 2.0.2，高等级问题仍需处理 |

两次公开报告时间分别为UTC `2026-09-06T23:39:59.448Z` 与 `2026-09-06T23:40:01.302Z`。npm数量按受影响包计，不是独立漏洞数量；内嵌发现单列，不混改npm统计。

## 本次实际证据

- 独立候选位于 `/private/tmp/hengda-dependency-eval-qBDzhz/candidate`。仅复制程序、测试与构建配置，不含原D1/R2数据、备份或环境密钥。使用独立node_modules，安装vinext 1.0.0-beta.9及其配套@vitejs/plugin-rsc 0.5.34，禁用安装脚本。没有修改正在使用的根目录依赖、锁文件或服务。
- 隔离候选的完整 `npm test`（含构建、单元、存储、事务、导出和备份专项）通过，但尚未进行该候选的完整Worker HTTP或浏览器验收；不能把这些测试当作安全风险已消失。
- 内嵌解析文件SHA-256为 `456ef3528be51418bebdd975aac4b6f4345610964166d1492220b35d686c8d15`。其ICNS循环仍按输入给出的条目长度推进，零长度不会前进。
- 使用 `tests/image-parser-probe.mjs`，在内存限制32MiB、单次最多250ms的独立子进程中验证。正常1×1 SVG返回尺寸；新版内嵌解析器处理零长度ICNS条目时在进入解析后超时，由父进程终止。当前版本解析器对异常样本也未正常返回并被终止，但该次结果未标为超时，不将其具体终止原因补猜为同一种。没有把异常样本送往3011服务、上传业务库或写入原件目录。

## 已补强的检查

`npm run security:audit` 保留npm全部依赖范围，并额外检查已观察到的vinext内嵌image-size目录：

- `counts`继续仅表示npm依赖图统计，`bundledFindings`记录内嵌路径、版本、代码哈希和公告。
- 即使npm报告零告警，只要存在内嵌待处理项，命令仍以非零退出，不输出“安全通过”。
- 新的未知内嵌版本标为需复核；符号链接或不可核验布局报错，不静默忽略。
- 这是针对已知目录布局的补查，不是完整SBOM、通用内嵌代码识别或零漏洞证明。路径不存在也不能证明框架没有以另一种方式打包依赖。
- 4项安全检查测试通过，含“npm零告警但存在内嵌风险”的防误判用例；定向ESLint通过。

上述解析器证据不等于已经证明普通业务附件可远程触发漏洞。当前已观察调用点在构建期，实际业务附件存入R2，不据包名或告警级别直接推断完整运行时攻击路径。后续应继续验证可达性与受支持的缓解方式；在此之前，保留高等级告警，不强制升级、改写node_modules、删除审计项或擅自接受风险。
