import type { ProjectArchiveData } from "./export-v2";
import { sheetByCode } from "./sheets-v2";
import { streamZip, zipContentLength, type ZipEntry } from "./zip-stream";

const encoder = new TextEncoder();

export function archiveFileName(original: string) {
  // Names are untrusted labels, never extraction paths. Numbered prefixes also
  // prevent reserved Windows device names and case-insensitive collisions.
  const wellFormed = Array.from(original).map((char) => {
    const point = char.codePointAt(0)!;
    return point >= 0xd800 && point <= 0xdfff ? "_" : char;
  }).join("");
  let clean = wellFormed.normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "_").replace(/^\.+|[. ]+$/g, "").trim();
  if (!clean) clean = "未命名附件";
  const match = clean.match(/\.[A-Za-z0-9]{1,12}$/);
  const extension = match?.[0] || "";
  const stem = extension ? clean.slice(0, -extension.length) : clean;
  let shortened = "";
  for (const char of stem) {
    if (encoder.encode(shortened + char + extension).length > 160) break;
    shortened += char;
  }
  return (shortened || "附件") + extension;
}

export async function prepareProjectBundle(data: ProjectArchiveData, bucket: R2Bucket | undefined, author: string) {
  const documents = [...data.documents].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (documents.length && !bucket) throw new Error("附件存储未就绪，无法生成含原件的归档。");
  if (documents.length + 4 > 65535) throw new Error("附件数超出标准ZIP上限，请拆分项目归档。");
  const ids = new Set<string>();
  const attachments: { entry: ZipEntry; record: Record<string, unknown> }[] = [];
  for (const [index, document] of documents.entries()) {
    if (document.projectId !== data.project.id || !document.objectKey.startsWith(`npd/${data.project.id}/`) ||
      !Object.hasOwn(sheetByCode, document.sheetCode) || ids.has(document.id)) throw new Error("附件归属或阶段记录异常，请管理员核对后归档。");
    ids.add(document.id);
    if (!Number.isSafeInteger(document.size) || document.size < 0) throw new Error(`附件大小记录无效：${document.fileName}`);
    const metadata = await bucket!.head(document.objectKey);
    if (!metadata) throw new Error(`附件原件缺失，未生成归档：${document.fileName}`);
    if (metadata.size !== document.size || !metadata.etag) throw new Error(`附件原件与记录不一致，未生成归档：${document.fileName}`);
    const sheet = sheetByCode[document.sheetCode];
    const path = `03_附件原件/${sheet.index.toString().padStart(2, "0")}_${sheet.shortTitle}/${String(index + 1).padStart(5, "0")}_${archiveFileName(document.fileName)}`;
    attachments.push({ entry: { path, size: metadata.size, async open() {
      const object = await bucket!.get(document.objectKey, { onlyIf: { etagMatches: metadata.etag } });
      if (!object || !("body" in object) || !object.body || object.etag !== metadata.etag || object.size !== metadata.size) {
        if (object && "body" in object && object.body) await object.body.cancel();
        throw new Error(`附件在下载期间发生变化或缺失：${document.fileName}`);
      }
      return object.body;
    } }, record: { path, documentId: document.id, originalFileName: document.fileName, sheetCode: document.sheetCode,
      sheetTitle: sheet.title, motorId: document.motorId, linkedRecordId: document.linkedRecordId, kind: document.kind,
      version: document.version, contentType: document.contentType, size: metadata.size, etag: metadata.etag,
      uploadedBy: document.uploadedByName, uploadedAt: document.createdAt } });
  }
  zipContentLength(attachments.map((item) => item.entry));
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    finish(word: Blob, excel: Blob) {
      const blobEntry = (path: string, blob: Blob): ZipEntry => ({ path, size: blob.size, open: () => blob.stream() });
      const manifest = { format: "hengda-project-archive-v1", projectId: data.project.id, projectCode: data.project.code,
        projectName: data.project.name, generatedAt, capturedAt: data.capturedAt || null,
        consistency: data.capturedAt ? "d1-single-read-transaction" : "provided-data",
        exportedBy: author, attachmentCount: attachments.length,
        files: { word: "01_开发程序.docx", excel: "02_完整项目数据.xlsx" },
        stageVersions: data.sheets.map((sheet) => ({ code: sheet.code, version: sheet.version, updatedAt: sheet.updatedAt })),
        attachments: attachments.map((item) => item.record) };
      const readme = `亨达新品开发 · 项目离线归档
项目：${data.project.code} ${data.project.name}
数据读取时间（UTC）：${data.capturedAt || "未提供，不作一致时点保证"}
文件生成时间（UTC）：${generatedAt}
导出人员：${author}

01_开发程序.docx：当前开发程序及各阶段变更摘要。
02_完整项目数据.xlsx：完整项目数据、操作日志及已保存的历史快照。
03_附件原件：当前项目附件记录对应的全部原始文件，共${attachments.length}个；旧版附件也保留。
04_附件清单.json：原文件名与包内路径、阶段、版次、规格及关联记录的对应关系。

附件按阶段分目录，增加序号并处理不安全/过长文件名，原文件名保留在清单中。附件内容不修改、不转换。没有附件时文件夹不会出现，清单数量为0。
此ZIP未加密，包含图纸、报告等敏感资料，请仅存放在受控位置。解压前确认下载完整且ZIP校验通过；中断的文件不能作为有效档案。
生成前检查附件存在及大小；读取时核对ETag并校验实际长度，ZIP自带CRC校验，但不等同数字签名。
${data.capturedAt ? "本系统导出使用同一次数据库只读事务的数据；读取完成后发生的修改不进入本包。附件字节另行从存储读取，不属于数据库事务，丢失或预检查后变化会使下载失败。" : "数据由调用方提供，未声明数据库一致时点。"}
不是签章审批或整库备份，不支持直接导入恢复；正式归档仍需完成企业审批与受控留存。已开始的下载不因随后权限变更自动追回。
`;
      const entries = [blobEntry("00_归档说明.txt", new Blob([readme], { type: "text/plain;charset=utf-8" })),
        blobEntry("01_开发程序.docx", word), blobEntry("02_完整项目数据.xlsx", excel),
        blobEntry("04_附件清单.json", new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" })),
        ...attachments.map((item) => item.entry)];
      return streamZip(entries);
    },
  };
}
