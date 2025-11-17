import { beforeAll, afterEach, describe, expect, test, vi } from "vitest";
import { Readable } from "stream";
import fs from "fs/promises";

const sendMock = vi.fn();
const capturedConfigs: Array<Record<string, unknown>> = [];

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    constructor(options: Record<string, unknown>) {
      capturedConfigs.push(options);
    }

    send = sendMock;
  }

  class MockGetObjectCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return {
    S3Client: MockS3Client,
    GetObjectCommand: MockGetObjectCommand,
    __esModule: true,
  };
});

type BrowserstackS3Module = typeof import("../providers/browserstack/s3.js");
let browserstackS3: BrowserstackS3Module;

beforeAll(async () => {
  browserstackS3 = await import("../providers/browserstack/s3.js");
});

afterEach(async () => {
  sendMock.mockReset();
  capturedConfigs.length = 0;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
});

describe("browserstack S3 helpers", () => {
  test("parseS3Uri extracts bucket and decoded key", () => {
    const result = browserstackS3.parseS3Uri(
      "s3://my-bucket/builds/app%20v2.ipa",
    );
    expect(result).toEqual({
      bucket: "my-bucket",
      key: "builds/app v2.ipa",
    });
  });

  test("downloadS3Artifact saves file locally and cleans up", async () => {
    process.env.AWS_REGION = "us-west-2";
    sendMock.mockResolvedValueOnce({
      Body: Readable.from(["test-binary"]),
    });

    const artifact = await browserstackS3.downloadS3Artifact(
      "s3://test-bucket/apps/mobile.apk",
    );

    const fileContents = await fs.readFile(artifact.filePath, "utf-8");
    expect(fileContents).toBe("test-binary");

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
      input: { Bucket: "test-bucket", Key: "apps/mobile.apk" },
    });
    expect(capturedConfigs[0]).toMatchObject({ region: "us-west-2" });

    await artifact.cleanup();
    await expect(fs.stat(artifact.filePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("downloadS3Artifact throws when region is missing", async () => {
    sendMock.mockResolvedValueOnce({
      Body: Readable.from(["unused"]),
    });

    await expect(
      browserstackS3.downloadS3Artifact("s3://bucket/key"),
    ).rejects.toThrow(/AWS_REGION/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("isS3Uri differentiates schemes", () => {
    expect(browserstackS3.isS3Uri("s3://bucket/key")).toBe(true);
    expect(browserstackS3.isS3Uri("https://example.com/app.apk")).toBe(false);
    expect(browserstackS3.isS3Uri("bs://sample-app")).toBe(false);
  });
});
