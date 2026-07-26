# 恒达新品开发协同系统

依据《产品开发控制程序》及 HD/JL-SJ-01A1～10A1 表单设计的电机新品开发全流程系统。系统把立项、策划、输入、设计、评审、验证、确认、定型、变更与归档串成一条可追踪的项目主线，并把客户订单、负责人、计划日期、实际日期、审批证据和文件版本关联到同一项目。

## 已实现范围

- 9 个项目关口：立项 → 策划 → 输入评审 → 设计输出 → 输出评审 → 样机验证 → 客户/鉴定确认 → 定型下发 → 变更归档
- 10 份受控表单的在线填写、保存、提交与审批状态管理
- 客户和销售订单关联、交付日期与项目计划联动
- 销售订单录入、型号/交期约束、关联与解除关联
- 项目组合工作台、里程碑进度、受阻预警、问题建立与验证关闭
- 全新产品完整流程，以及派生/改进产品经授权的风险裁剪
- 项目暂停、恢复、终止和待审批自动关闭
- 设计变更申请、批准/退回、外部通知、库存处置与实施验证归档
- D1 结构化数据、R2 文件附件、活动审计轨迹
- 12 类角色的服务端权限校验与前端功能可见性控制
- 面向管理层、技术、工艺、质量、制造、采购、销售、财务的协同视图

详细业务蓝图见 [docs/system-blueprint.md](docs/system-blueprint.md)，逐项完成度与验证证据见 [docs/completion-audit.md](docs/completion-audit.md)。

## 本地运行

环境要求：Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

验证：

```bash
npm run build
npm test
npm run lint
```

仅运行不依赖浏览器的数据库业务闭环测试：

```bash
npm run test:store
```

数据库结构变更后生成迁移：

```bash
npm run db:generate
```

本地预览使用 Cloudflare Miniflare 自动提供 D1 `DB` 和 R2 `FILES` 绑定，首次访问会创建表并写入一组演示项目。线上身份通过 ChatGPT 工作区身份头解析；首位登录用户取得系统管理员角色，后续未知用户默认只读，需由管理员分配岗位。

## 关键目录

- `app/components/NpdApp.tsx`：业务工作台与交互
- `app/api/`：数据、操作、附件 API
- `db/schema.ts`：Drizzle 数据模型
- `db/store.ts`：D1 初始化、种子数据和业务写操作
- `lib/forms.ts`：10 份受控表单定义
- `lib/permissions.ts`：岗位权限矩阵
- `docs/system-blueprint.md`：流程、权限与数据蓝图
