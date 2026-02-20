import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import playwrightTest from "@playwright/test";

// --- Mock gpt-driver-node ---
// vi.hoisted runs before vi.mock hoisting, so variables are available in the factory
const { MockGptDriver, mockAiExecute } = vi.hoisted(() => {
  const mockAiExecute = vi.fn().mockResolvedValue(undefined);
  // Must use function (not arrow) so it can be called with `new`
  const MockGptDriver = vi.fn(function (this: any, config: any) {
    this.aiExecute = mockAiExecute;
    this.assert = vi.fn().mockResolvedValue(undefined);
    this.assertBulk = vi.fn().mockResolvedValue(undefined);
    this.checkBulk = vi.fn().mockResolvedValue({});
    this.extract = vi.fn().mockResolvedValue({});
    this.testId = config.testId;
  });
  return { MockGptDriver, mockAiExecute };
});

vi.mock("gpt-driver-node", () => ({ default: MockGptDriver }));

// --- Mock Playwright test helpers ---
let currentTestId: string | undefined = "test-initial";
(playwrightTest as unknown as { step: Function }).step = vi.fn(
  async (_name: string, body: () => Promise<unknown>) => await body(),
);
(playwrightTest as unknown as { info: () => any }).info = () =>
  currentTestId ? { testId: currentTestId } : undefined;
(playwrightTest as unknown as { skip: Function }).skip = vi.fn();

import { GptDriverProvider } from "../gptDriver";

function createProvider() {
  return new GptDriverProvider({
    options: {
      protocol: "http",
      hostname: "localhost",
      port: 4723,
      path: "/wd/hub",
    },
  } as any);
}

describe("GptDriverProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTestId = "test-initial";
    process.env.GPT_DRIVER_API_KEY = "fake-key";
  });

  afterEach(() => {
    delete process.env.GPT_DRIVER_API_KEY;
  });

  describe("testId tracks current test context", () => {
    test("initializes testId from first call's test context", async () => {
      const provider = createProvider();
      currentTestId = "test-first";

      await provider.aiExecute("login");

      const driver = (provider as any).driver;
      expect(driver.testId).toBe("test-first");
    });

    test("updates testId when a different test uses the same device", async () => {
      const provider = createProvider();

      // Test A runs
      currentTestId = "test-aaa";
      await provider.aiExecute("tap the submit button");
      expect((provider as any).driver.testId).toBe("test-aaa");

      // Test B runs on the same persistent device
      currentTestId = "test-bbb";
      await provider.aiExecute("verify the results screen");
      expect((provider as any).driver.testId).toBe("test-bbb");
    });

    test("fixture teardown uses the current test's ID, not the first", async () => {
      const provider = createProvider();

      // Test A runs
      currentTestId = "test-aaa";
      await provider.aiExecute("perform action");

      // Fixture teardown runs in Test A's context
      await provider.aiExecute("navigate back to home");
      expect((provider as any).driver.testId).toBe("test-aaa");

      // Test B starts with new context
      currentTestId = "test-bbb";
      await provider.aiExecute("perform another action");
      expect((provider as any).driver.testId).toBe("test-bbb");

      // Fixture teardown runs in Test B's context
      await provider.aiExecute("navigate back to home");
      expect((provider as any).driver.testId).toBe("test-bbb");
    });

    test("preserves testId when test.info() returns undefined", async () => {
      const provider = createProvider();

      currentTestId = "test-known";
      await provider.aiExecute("do something");
      expect((provider as any).driver.testId).toBe("test-known");

      // Worker teardown — no test context
      currentTestId = undefined;
      await provider.aiExecute("cleanup");
      expect((provider as any).driver.testId).toBe("test-known");
    });

    test("warns once if testId property is missing from driver", async () => {
      const provider = createProvider();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      currentTestId = "test-aaa";
      await provider.aiExecute("initialize");

      // Remove testId to simulate SDK rename/removal
      delete (provider as any).driver.testId;

      currentTestId = "test-bbb";
      await provider.aiExecute("second call");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot update testId"),
      );

      // Should not warn again on subsequent calls
      currentTestId = "test-ccc";
      await provider.aiExecute("third call");
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });
  });

  describe("lazy singleton", () => {
    test("creates GptDriver instance only once", async () => {
      const provider = createProvider();

      currentTestId = "test-1";
      await provider.aiExecute("first");

      currentTestId = "test-2";
      await provider.aiExecute("second");

      currentTestId = "test-3";
      await provider.aiExecute("third");

      expect(MockGptDriver).toHaveBeenCalledTimes(1);
    });

    test("does not create GptDriver when API key is missing", async () => {
      delete process.env.GPT_DRIVER_API_KEY;
      const provider = createProvider();

      // Should call test.skip and throw
      await expect(provider.aiExecute("anything")).rejects.toThrow(
        "GPT Driver not configured",
      );
      expect(MockGptDriver).not.toHaveBeenCalled();
    });
  });
});
