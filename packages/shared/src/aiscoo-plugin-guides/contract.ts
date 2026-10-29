import { z } from "zod";
import { modelSelectionSchema } from "../model-selection.js";
import {
  zcodePluginsDescribeParamsSchema,
  zcodeWorkspaceGenerateTextParamsSchema,
} from "../zcode-protocol/index.js";

export const PLUGIN_GUIDE_TEMPLATE_VERSION = 1;
export const PLUGIN_GUIDE_REPLY_START = "<reply>";
export const PLUGIN_GUIDE_REPLY_END = "</reply>";
export const PLUGIN_GUIDE_DOCUMENT_START = "<guide>";
export const PLUGIN_GUIDE_DOCUMENT_END = "</guide>";
export const PLUGIN_GUIDE_MAX_DOCUMENT_BYTES = 256 * 1024;
export const PLUGIN_GUIDE_MAX_SOURCE_BYTES = 256 * 1024;
export const PLUGIN_GUIDE_MAX_SOURCE_FILES = 64;
export const PLUGIN_GUIDE_SECTIONS = [
  { id: "overview", title: { "zh-CN": "认识这个插件", "en-US": "Meet the plugin" } },
  { id: "when", title: { "zh-CN": "什么时候适合用", "en-US": "When to use it" } },
  { id: "preparation", title: { "zh-CN": "使用前的准备", "en-US": "Before you start" } },
  { id: "quickstart", title: { "zh-CN": "快速上手", "en-US": "Quick start" } },
  { id: "scenarios", title: { "zh-CN": "实际场景示例", "en-US": "Practical examples" } },
  { id: "limits", title: { "zh-CN": "能力边界与注意事项", "en-US": "Limits and considerations" } },
  { id: "faq", title: { "zh-CN": "常见问题与参考资料", "en-US": "Questions and sources" } },
] as const;

export const pluginGuideLocaleSchema = z.enum(["zh-CN", "en-US"]);
export type PluginGuideLocale = z.infer<typeof pluginGuideLocaleSchema>;
const identityString = z.string().trim().min(1).max(4096);
export const pluginGuideTargetSchema = z
  .object({
    workspacePath: identityString,
    workspaceIdentity: identityString.optional(),
    remoteSessionId: identityString.optional(),
    pluginName: identityString,
    marketplace: identityString,
    locale: pluginGuideLocaleSchema,
    version: z.string().max(256).optional(),
  })
  .strict();
export type PluginGuideTarget = z.infer<typeof pluginGuideTargetSchema>;
export function pluginGuideTargetKey(target: PluginGuideTarget): string {
  return JSON.stringify([
    target.workspaceIdentity?.trim() || target.workspacePath,
    target.workspacePath,
    target.remoteSessionId ?? null,
    target.marketplace,
    target.pluginName,
    target.locale,
    target.version ?? null,
  ]);
}

export const pluginGuideMessageSchema = z
  .object({
    id: identityString,
    role: z.enum(["user", "assistant"]),
    content: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict();
export type PluginGuideMessage = z.infer<typeof pluginGuideMessageSchema>;
const markdownSchema = z
  .string()
  .min(1)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= PLUGIN_GUIDE_MAX_DOCUMENT_BYTES,
    "Plugin guide exceeds its document limit",
  );
export const pluginGuideDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    templateVersion: z.literal(PLUGIN_GUIDE_TEMPLATE_VERSION),
    pluginId: identityString,
    sourceIdentity: identityString,
    sourceRevision: identityString,
    fingerprint: identityString,
    version: z.string().max(256).optional(),
    locale: pluginGuideLocaleSchema,
    markdown: markdownSchema,
    messages: z.array(pluginGuideMessageSchema).max(200),
    updatedAt: z.string().datetime(),
    revision: identityString,
    sourcePaths: z.array(z.string().min(1).max(4096)).max(PLUGIN_GUIDE_MAX_SOURCE_FILES),
    diagnostics: z.array(z.string().max(4096)).max(100),
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    selection: modelSelectionSchema.optional(),
  })
  .strict();
export type PluginGuideDocument = z.infer<typeof pluginGuideDocumentSchema>;

export const pluginGuidePhaseSchema = z.enum([
  "idle",
  "reading",
  "generating",
  "saving",
  "ready",
  "unsaved",
  "error",
  "cancelled",
]);
export const pluginGuideSnapshotSchema = z
  .object({
    key: identityString,
    target: pluginGuideTargetSchema,
    sequence: z.number().int().nonnegative(),
    phase: pluginGuidePhaseSchema,
    document: pluginGuideDocumentSchema.nullable(),
    messages: z.array(pluginGuideMessageSchema).max(201),
    previewMarkdown: z.string().max(PLUGIN_GUIDE_MAX_DOCUMENT_BYTES),
    previewReply: z.string().max(64 * 1024),
    operationId: identityString.optional(),
    error: z.string().max(8192).optional(),
    stale: z.boolean(),
  })
  .strict();
export type PluginGuideSnapshot = z.infer<typeof pluginGuideSnapshotSchema>;
export const pluginGuidePreviewSchema = z
  .object({
    type: z.literal("preview"),
    key: identityString,
    target: pluginGuideTargetSchema,
    sequence: z.number().int().positive(),
    operationId: identityString,
    markdownDelta: z.string().max(PLUGIN_GUIDE_MAX_DOCUMENT_BYTES),
    replyDelta: z.string().max(64 * 1024),
  })
  .strict();
export type PluginGuidePreview = z.infer<typeof pluginGuidePreviewSchema>;
export const pluginGuideChangeSchema = z.union([
  pluginGuidePreviewSchema,
  pluginGuideSnapshotSchema,
]);
export type PluginGuideChange = z.infer<typeof pluginGuideChangeSchema>;
export const pluginGuideGenerateParamsSchema = z
  .object({
    target: pluginGuideTargetSchema,
    operationId: identityString,
    question: z
      .string()
      .trim()
      .min(1)
      .max(16 * 1024)
      .optional(),
    regenerate: z.boolean().optional(),
    selection: modelSelectionSchema.optional(),
  })
  .strict();
export type PluginGuideGenerateParams = z.infer<typeof pluginGuideGenerateParamsSchema>;

export const pluginGuideSourceParamsSchema = zcodePluginsDescribeParamsSchema.extend({
  mode: z.enum(["identity", "documents"]).default("documents"),
});
export const pluginGuideSourceSchema = z
  .object({
    pluginId: identityString,
    sourceIdentity: identityString,
    sourceRevision: identityString,
    fingerprint: identityString,
    fingerprintKind: z.enum(["content", "revision"]).default("revision"),
    version: z.string().max(256).optional(),
    documents: z
      .array(
        z
          .object({
            path: z.string().min(1).max(4096),
            text: z.string().max(PLUGIN_GUIDE_MAX_SOURCE_BYTES),
          })
          .strict(),
      )
      .max(PLUGIN_GUIDE_MAX_SOURCE_FILES),
    diagnostics: z.array(z.string().max(4096)).max(100),
  })
  .strict()
  .refine(
    (value) =>
      value.documents.reduce(
        (bytes, document) => bytes + new TextEncoder().encode(document.text).byteLength,
        0,
      ) <= PLUGIN_GUIDE_MAX_SOURCE_BYTES,
    "Plugin guide source exceeds its material limit",
  );
export type PluginGuideSource = z.infer<typeof pluginGuideSourceSchema>;
export type PluginGuideSourceParams = z.infer<typeof pluginGuideSourceParamsSchema>;
export const pluginGuideStreamTextParamsSchema = zcodeWorkspaceGenerateTextParamsSchema.safeExtend({
  operationId: identityString,
});
export const pluginGuideTextDeltaSchema = z
  .object({
    operationId: identityString,
    sequence: z.number().int().positive(),
    text: z.string().min(1).max(PLUGIN_GUIDE_MAX_DOCUMENT_BYTES),
  })
  .strict();
export type PluginGuideTextDelta = z.infer<typeof pluginGuideTextDeltaSchema>;

/** Preview is never a saved revision; incomplete closing markers stay outside the visible text. */
export function previewPluginGuideResponse(text: string): { reply: string; markdown: string } {
  const reply = extractResponseBlock(text, PLUGIN_GUIDE_REPLY_START, PLUGIN_GUIDE_REPLY_END);
  const markdown = extractResponseBlock(
    text,
    PLUGIN_GUIDE_DOCUMENT_START,
    PLUGIN_GUIDE_DOCUMENT_END,
  );
  return { reply: reply.trim(), markdown: markdown.trim() };
}
function extractResponseBlock(text: string, start: string, end: string): string {
  const startAt = text.indexOf(start);
  if (startAt < 0) return "";
  const content = text.slice(startAt + start.length);
  const endAt = content.indexOf(end);
  if (endAt >= 0) return content.slice(0, endAt);
  for (let size = Math.min(content.length, end.length - 1); size > 0; size -= 1) {
    if (content.endsWith(end.slice(0, size))) return content.slice(0, -size);
  }
  return content;
}
export function parsePluginGuideResponse(
  text: string,
  locale: PluginGuideLocale,
): { reply: string; markdown: string } {
  const match =
    /^\s*(?:```(?:markdown|xml|text)?\s*\n)?<reply>([^]*?)<\/reply>\s*<guide>([^]*?)<\/guide>(?:\s*```)?\s*$/u.exec(
      text,
    );
  if (!match) throw new Error("The model did not return a complete plugin guide response");
  const reply = match[1]!.trim();
  const markdown = markdownSchema.parse(match[2]!.trim());
  const lines = markdown.split("\n");
  const headings: { text: string; position: number }[] = [];
  let fence: string | undefined;
  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position]!;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1]![0] === fence[0] &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      )
        fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const heading = /^ {0,3}(## .+?)\s*$/u.exec(line);
    if (heading) headings.push({ text: heading[1]!, position });
  }
  // 示例代码中的标题不属于目录，重复章节也不能冒充完整七章。
  if (headings.length !== PLUGIN_GUIDE_SECTIONS.length)
    throw new Error("The plugin guide must contain exactly seven chapters");
  for (let index = 0; index < PLUGIN_GUIDE_SECTIONS.length; index += 1) {
    const section = PLUGIN_GUIDE_SECTIONS[index]!;
    const heading = headings[index]!;
    if (heading.text !== `## ${section.title[locale]}`)
      throw new Error(`The plugin guide is missing its ${section.id} section`);
    if (
      !lines
        .slice(heading.position + 1, headings[index + 1]?.position)
        .join("\n")
        .trim()
    ) {
      throw new Error(`The plugin guide has an empty ${section.id} section`);
    }
  }
  if (!reply) throw new Error("The model did not answer the guide question");
  return { reply, markdown };
}
