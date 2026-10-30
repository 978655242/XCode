import { describe, expect, it } from "vitest";
import * as current from "@zcode/ui/aiscoo-brand";
import * as legacy from "@zcode/ui/xwork-brand";

describe("Aiscoo brand entrypoint", () => {
  it("shares the same UI implementation with the legacy entrypoint", () => {
    expect(current.AiscooIntlProvider).toBe(legacy.AiscooIntlProvider);
    expect(current.AiscooAppLogo).toBe(legacy.AiscooAppLogo);
  });
});
