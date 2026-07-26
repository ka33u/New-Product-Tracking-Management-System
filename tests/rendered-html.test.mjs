import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("production entry renders the NPD application", async () => {
  const [page, layout, packageJson, hosting] = await Promise.all([
    source("app/page.tsx"),
    source("app/layout.tsx"),
    source("package.json"),
    source(".openai/hosting.json"),
  ]);

  assert.match(page, /<NpdApp/);
  assert.match(page, /getWorkspaceSnapshot/);
  assert.match(page, /resolveCurrentUser/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /恒达新品开发协同系统/);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(JSON.parse(hosting), { d1: "DB", r2: "FILES" });
});

test("workflow, forms, permissions, and persistence stay wired", async () => {
  const [component, forms, permissions, schema, store] = await Promise.all([
    source("app/components/NpdApp.tsx"),
    source("lib/forms.ts"),
    source("lib/permissions.ts"),
    source("db/schema.ts"),
    source("db/store.ts"),
  ]);

  for (const code of [
    "HD/JL-SJ-01A1",
    "HD/JL-SJ-02A1",
    "HD/JL-SJ-03A1",
    "HD/JL-SJ-04A1",
    "HD/JL-SJ-05A1",
    "HD/JL-SJ-06A1",
    "HD/JL-SJ-07A1",
    "HD/JL-SJ-08A1",
    "HD/JL-SJ-09A1",
    "HD/JL-SJ-10A1",
  ]) {
    assert.match(forms, new RegExp(code.replaceAll("/", "\\/")));
  }

  for (const capability of [
    "order:link",
    "order:manage",
    "project:tailor",
    "approval:decide",
    "change:approve",
    "user:manage",
    "audit:view",
  ]) {
    assert.match(permissions, new RegExp(capability));
  }

  assert.match(component, /订单关联/);
  assert.match(component, /录入销售订单/);
  assert.match(component, /进度与分析/);
  assert.match(component, /人员与权限/);
  assert.match(component, /新增项目问题/);
  assert.match(component, /变更实施与效果验证/);
  assert.match(component, /确认风险裁剪/);
  assert.match(component, /终止项目/);
  assert.match(schema, /salesOrders/);
  assert.match(schema, /changeRequests/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS milestones/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS form_records/);
  assert.match(store, /export async function setOrderLink/);
  assert.match(store, /export async function createIssue/);
  assert.match(store, /export async function verifyChangeRequest/);
  assert.match(store, /export async function waiveMilestone/);
  assert.match(store, /export async function terminateProject/);
});
