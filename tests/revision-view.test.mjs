import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/revision-view.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { snapshotRows, compareSnapshots, originalEvidenceChecks, revisionDisplayValue } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const snapshot = (overrides = {}) => ({ data: { forms: [], motors: [], parts: [], tests: [], inspections: [], documents: [], ...overrides } });

test("historical display uses explicit Beijing time with seconds but preserves dates and unknown values", () => {
  for (const input of ["2026-09-08 02:26:04", "2026-09-08T02:26:04Z", "2026-09-08T10:26:04+08:00", "2026-09-08T10:26:04+0800"]) {
    assert.equal(revisionDisplayValue("confirmed_at", input), "2026-09-08 10:26:04（北京时间）");
  }
  assert.equal(revisionDisplayValue("created_at", "2026-12-31 20:00:00"), "2027-01-01 04:00:00（北京时间）");
  assert.equal(revisionDisplayValue("updated_at", "2026-09-08T02:26:04.123Z"), "2026-09-08 10:26:04.123（北京时间）");
  for (const input of ["2026-02-30 02:00:00", "2026-09-08 24:00:00", "2026-09-08 02:99:00", "2026-09-08", "bad historical time"]) {
    assert.equal(revisionDisplayValue("created_at", input), input + "（历史时间格式未识别，保留原值）");
  }
  assert.equal(revisionDisplayValue("actual_date", "2026-09-08"), "2026-09-08");
  assert.equal(revisionDisplayValue("custom_time", "2026-09-08 02:26:04"), "2026-09-08 02:26:04");
  assert.equal(revisionDisplayValue("status", "completed"), "已完成");
  assert.equal(revisionDisplayValue("status", "legacy_unrecognized"), "legacy_unrecognized");
  assert.equal(revisionDisplayValue("production_note", "completed"), "completed");
  assert.equal(revisionDisplayValue("", 0), "0"); assert.equal(revisionDisplayValue("", false), "否");
  assert.equal(revisionDisplayValue("", null), "未记录"); assert.equal(revisionDisplayValue("", ""), "未填写");
  assert.equal(revisionDisplayValue("", []), "未选择");
  assert.equal(revisionDisplayValue("", ["A", "B"]), "A、B");
  const before = snapshot({ motors: [{ id: "m", confirmed_at: "2026-09-08 02:26:04", status: "completed", production_note: "A" }] });
  const original = JSON.stringify(before);
  for (const row of snapshotRows(before).values()) for (const [key, value] of Object.entries(row.value)) revisionDisplayValue(key, value);
  assert.equal(JSON.stringify(before), original);
  assert.deepEqual(compareSnapshots(before, JSON.parse(original)), []);
  const after = structuredClone(before); after.data.motors[0].confirmed_at = "2026-09-08T02:26:04Z";
  assert.equal(compareSnapshots(before, after).length, 1, "display-equivalent timestamps must not erase raw historical differences");
});

test("original checks preserve valid evidence without inventing missing legacy receipts", () => {
  const receipt = { documentId: "d", fileName: "报告<&>.pdf", size: 17, etag: "abc", checkedAt: "2026-09-07T00:00:00.123Z" };
  assert.deepEqual(originalEvidenceChecks({ evidenceOriginals: [{ ...receipt, objectKey: "private/key" }] }), [receipt]);
  for (const input of [null, {}, { evidenceOriginals: [] }, { evidenceOriginals: [receipt, receipt] },
    ...[{ size: 0 }, { size: "17" }, { etag: "" }, { checkedAt: "unknown" }, { documentId: null }]
      .map((patch) => ({ evidenceOriginals: [{ ...receipt, ...patch }] }))]) assert.equal(originalEvidenceChecks(input), null);
});

test("legacy, partial and duplicate snapshots do not fabricate removals", () => {
  for (const value of [null, {}, { source: "legacy" }, { data: { motors: [] } }, snapshot({ motors: [{ id: "a" }, { id: "a" }] })]) {
    assert.equal(snapshotRows(value), null);
    assert.equal(compareSnapshots(value, snapshot()), null);
  }
  assert.equal(snapshotRows(snapshot()).size, 0);
});
test("comparison identifies added, removed and changed records by stable identity", () => {
  const before = snapshot({ motors: [{ id: "m", model: "A", protection_grade: "IP55" }], parts: [{ id: "p", part_no: "P1" }] });
  const after = snapshot({ motors: [{ id: "m", model: "A", protection_grade: "IP56" }], tests: [{ id: "t", report_no: "T1" }] });
  const changes = compareSnapshots(before, after);
  assert.equal(changes.length, 3);
  assert.equal(changes.find((item) => item.key === "motors:m").kind, "修改");
  assert.equal(changes.find((item) => item.key === "parts:p").kind, "移除");
  assert.equal(changes.find((item) => item.key === "tests:t").kind, "新增");
  assert.equal(changes[0].before.protection_grade, "IP55");
  assert.equal(changes[0].after.protection_grade, "IP56");
});
test("object key ordering and serialized form payload formatting are not content changes", () => {
  const a = snapshot({ forms: [{ id: "f", payload: '{"name":"A","qty":1}' }] });
  const b = snapshot({ forms: [{ payload: '{ "qty":1, "name":"A" }', id: "f" }] });
  assert.deepEqual(compareSnapshots(a, b), []);
  assert.deepEqual(snapshotRows(a).get("forms:f").value.payload, { name: "A", qty: 1 });
});
