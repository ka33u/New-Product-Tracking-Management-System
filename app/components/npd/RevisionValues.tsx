"use client";
import { formDefinitions } from "../../../lib/forms";
import { revisionDisplayValue } from "../../../lib/revision-view";

const labels: Record<string, string> = {
  id: "记录标识", project_id: "项目标识", model: "型号规格", motor_code: "历史电机编码", rated_power: "额定功率", voltage: "电压", frequency: "频率",
  poles: "极数", speed: "转速", frame_size: "机座号", mounting: "安装方式", terminal_mode: "出线形式", protection_grade: "防护等级",
  insulation_class: "绝缘等级", cooling_method: "冷却方式", quantity: "数量", design_revision: "设计版次", inspection_requirement: "检验要求",
  test_requirement: "试验要求", planned_date: "计划完成", actual_date: "实际完成", status: "状态", created_at: "创建时间", updated_at: "更新时间",
  payload: "表单内容", form_code: "表单编号", sheet_code: "阶段编号", version: "版本", motor_id: "电机标识", part_no: "零部件编号",
  name: "名称", specification: "规格", material: "材质", source_type: "来源", design_output_ref: "设计输出引用", note: "说明",
  report_no: "报告编号", report_type: "报告类型", title: "标题", requirement_ref: "试验要求引用", requirement_revision: "依据设计版次",
  test_date: "试验日期", result: "结果", conclusion: "结论", document_id: "附件标识", item_type: "检验对象类型", part_item_id: "零部件标识",
  inspection_date: "检验日期", file_name: "文件名", kind: "附件类型", size: "文件大小（字节）", content_type: "文件格式",
  confirmed_by: "生产确认人（历史标识）", confirmed_at: "生产确认时间", production_note: "生产确认说明",
  submitted_by: "提交人（历史标识）", inspector_id: "检验人（历史标识）", uploaded_by: "上传人（历史标识）",
  updated_by: "维护人（历史标识）", linked_record_id: "关联记录标识", object_key: "附件存储标识",
};

export function RevisionValues({ value }: { value?: Record<string, unknown> }) {
  if (!value) return <p>此版本中无该记录</p>;
  const form = formDefinitions.find((item) => item.code === value.form_code);
  const payload = value.payload;
  const formLabels = new Map(form?.fields.map((field) => [field.key, field.label]) || []);
  return <>
    <dl className="npd2-version-values">{Object.entries(value).map(([key, item]) => <div key={key}>
      <dt>{labels[key] || key}</dt><dd>{key === "payload" && form && payload && typeof payload === "object" && !Array.isArray(payload)
        ? <dl>{Object.entries(payload).map(([field, content]) => <div key={field}><dt>{formLabels.get(field) || field}</dt><dd>{revisionDisplayValue("", content)}</dd></div>)}</dl>
        : revisionDisplayValue(key, item)}</dd>
    </div>)}</dl>
    <details><summary>查看字段原值（未转换时间与状态）</summary><pre className="npd2-version-raw">{JSON.stringify(value, null, 2)}</pre></details>
  </>;
}
