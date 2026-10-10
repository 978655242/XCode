import { z } from "zod";
import type { UserInfo } from "./oauth.js";

export const officialCloudFamilySchema = z.enum(["bigmodel", "zai"]);
export type OfficialCloudFamily = z.infer<typeof officialCloudFamilySchema>;
export const officialCloudPlanScopeSchema = z.discriminatedUnion("targetType", [
  z.object({ targetType: z.literal("PERSONAL") }).strict(),
  z
    .object({
      targetType: z.literal("TEAM"),
      organizationId: z.string().min(1),
      projectId: z.string().min(1),
      productId: z.string().min(1),
    })
    .strict(),
]);
export type OfficialCloudPlanScope = z.infer<typeof officialCloudPlanScopeSchema>;
export const officialCloudCatalogSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    providers: z.array(
      z
        .object({
          providerId: z.string().min(1),
          providerName: z.string().optional(),
          modelIds: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();
export type OfficialCloudCatalog = z.infer<typeof officialCloudCatalogSchema>;

export type OfficialCloudConnectionSnapshot = { pendingFamily: OfficialCloudFamily | null } & (
  | { status: "locked" }
  | { status: "disconnected" }
  | {
      status: "connected";
      connectionKey: string;
      credentialGeneration: string;
      family: OfficialCloudFamily;
      identity: UserInfo;
      planScope: OfficialCloudPlanScope | null;
      catalog: OfficialCloudCatalog;
    }
);
