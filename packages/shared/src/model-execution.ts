import { z } from "zod";

/** 文本与附件发送共用执行约束，凭据只属于单次执行，不进入 Session 配置。 */
export const modelExecutionSchema = z
  .object({
    memoryExtraction: z.literal("skip").optional(),
    selectionScope: z.literal("execution"),
    requestAuth: z
      .object({
        apiKey: z.string().min(1).optional(),
        headers: z.record(z.string().min(1), z.string().min(1)).optional(),
        // XCODE: 官方执行冻结非秘密 owner/connection 代际，不把 Native key 借给闲时模型。
        executionIdentity: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    subagents: z
      .object({
        foregroundModel: z.literal("submission"),
        background: z.literal("deny"),
      })
      .strict()
      .optional(),
  })
  .strict();
