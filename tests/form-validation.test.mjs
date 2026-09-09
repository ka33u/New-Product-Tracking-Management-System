import assert from "node:assert/strict";
import test from "node:test";
import { formDefinitions, formSubmissionIssues, formReleaseIssues } from "../lib/forms.ts";
import { validFormPayload } from "./form-release.mjs";

test("controlled submissions validate types, dates, options, quantities and chronological pairs", () => {
  for (const form of formDefinitions) {
    const valid = validFormPayload(form.code);
    assert.deepEqual(formSubmissionIssues(form, valid), []);
    for (const invalid of [null, [], "text", 1]) assert.ok(formSubmissionIssues(form, invalid).length);
    for (const field of form.fields) {
      if (field.type === "number") for (const invalid of [NaN, Infinity, -1, "1", true, []]) {
        assert.ok(formSubmissionIssues(form, { ...valid, [field.key]: invalid }).length, field.label);
      }
      if (field.type === "checkbox") assert.ok(formSubmissionIssues(form, { ...valid, [field.key]: "false" }).length);
      if (field.type === "multiselect") {
        for (const invalid of [field.options[0], [field.options[0], field.options[0]], [false]]) assert.ok(formSubmissionIssues(form, { ...valid, [field.key]: invalid }).length);
      }
    }
  }
  const byCode = (code) => formDefinitions.find((form) => form.shortCode === code);
  for (const [code, from, to] of [["SJ-01", "initiationDate", "requiredDate"], ["SJ-03", "listedDate", "completionDate"]]) {
    const form = byCode(code), valid = validFormPayload(form.code);
    assert.match(formSubmissionIssues(form, { ...valid, [from]: "2026-09-08", [to]: "2026-09-07" }).join(), /不能早于/);
    assert.deepEqual(formSubmissionIssues(form, { ...valid, [from]: "2024-02-29", [to]: "2024-03-01" }), []);
  }
  const trial = byCode("SJ-07"), valid = validFormPayload(trial.code);
  for (const sampleQuantity of [0, 0.5, 1.5]) assert.match(formSubmissionIssues(trial, { ...valid, sampleQuantity }).join(), /正整数/);
  const review = byCode("SJ-05");
  assert.deepEqual(formSubmissionIssues(review, { ...validFormPayload(review.code), conclusion: "不通过" }), []);
  assert.match(formReleaseIssues(review, { ...validFormPayload(review.code), conclusion: "不通过" }).join(), /不通过/);
});
