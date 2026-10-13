import assert from "node:assert/strict";
import test from "node:test";
import type { NativeCodingPlanReadSnapshot } from "@zcode/shared";
import {
  formatNativePlanPrice,
  getNativePlanReferenceOffers,
} from "../../ui/src/settings/model-provider-section/nativePlanSettingsPresentation.js";
import { formatModelContextWindowLabel } from "../../ui/src/lib/tokenNumberFormat.js";

type Plan = NativeCodingPlanReadSnapshot["plans"][number];
const plan: Plan = {
  id: "1",
  title: "Personal",
  subtitle: "For individuals",
  priceAmount: "118.00",
  currency: "CNY",
  durationUnit: "month",
  durationValue: "1",
  durationCustomSeconds: "0",
  totalQuota: "500000",
  resetPeriod: "monthly",
  resetCustomSeconds: "0",
  enabled: true,
};

test("reference prices exclude disabled templates and never compare different currencies or periods", () => {
  const plans = [
    plan,
    { ...plan, id: "2", priceAmount: "98.00" },
    { ...plan, id: "3", priceAmount: "0.01", enabled: false },
    { ...plan, id: "4", priceAmount: "18.00", currency: "USD" },
    { ...plan, id: "5", priceAmount: "258.00", durationValue: "3" },
  ];
  assert.deepEqual(
    getNativePlanReferenceOffers(plans).map((item) => item.id),
    ["2", "4", "5"],
  );
  assert.deepEqual(getNativePlanReferenceOffers([]), []);
});

test("reference prices preserve decimal precision beyond binary floats", () => {
  assert.equal(
    getNativePlanReferenceOffers([
      { ...plan, id: "higher", priceAmount: "9007199254740992.02" },
      { ...plan, id: "lower", priceAmount: "9007199254740992.01" },
    ])[0]?.id,
    "lower",
  );
});

test("displaying Native reference prices preserves exact decimals and unknown currency labels", () => {
  assert.equal(
    formatNativePlanPrice("9007199254740992.01", "USD", "en-US"),
    "$9,007,199,254,740,992.01",
  );
  assert.equal(formatNativePlanPrice("0.123456", "CNY", "zh-CN"), "¥0.123456");
  assert.equal(formatNativePlanPrice("98.00", "PRIVATE_CREDIT", "en-US"), "98.00 PRIVATE_CREDIT");
});

test("model context badges preserve exact published token capacities", () => {
  const capacities = [
    [1_050_000, "1.05M"],
    [1_048_576, "1.048576M"],
    [202_752, "202.752K"],
    [204_800, "204.8K"],
    [200_000, "200K"],
    [1_000_000, "1M"],
  ] as const;
  for (const [tokens, label] of capacities) {
    assert.equal(formatModelContextWindowLabel(tokens, "zh-CN"), label);
    assert.equal(formatModelContextWindowLabel(tokens, "en-US"), label);
  }
});
