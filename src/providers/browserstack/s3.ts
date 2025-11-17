import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import {
  S3Client,
  GetObjectCommand,
  GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

const S3_SCHEME = "s3://";
const TEMP_PREFIX = "appwright-s3-";

export type DownloadedS3Artifact = {
  filePath: string;
  cleanup: () => Promise<void>;
};

export function isS3Uri(value: string): boolean {
  return value.startsWith(S3_SCHEME);
}

export function parseS3Uri(uri: string): { bucket: string; key: string } {
  if (!isS3Uri(uri)) {
    throw new Error(`Invalid S3 URI: ${uri}`);
  }
  const remainder = uri.slice(S3_SCHEME.length);
  const firstSlash = remainder.indexOf("/");
  if (firstSlash === -1) {
    throw new Error(
      `S3 URI must be in the format s3://bucket/key. Received: ${uri}`,
    );
  }
  const bucket = remainder.slice(0, firstSlash);
  const key = remainder.slice(firstSlash + 1);
  if (!bucket || !key) {
    throw new Error(`S3 URI must include both bucket and key: ${uri}`);
  }
  return {
    bucket,
    key: decodeURIComponent(key),
  };
}

type S3Body = GetObjectCommandOutput["Body"];

async function writeBodyToFile(
  body: S3Body,
  destination: string,
): Promise<void> {
  if (!body) {
    throw new Error("Received empty S3 object body");
  }

  if (body instanceof Readable) {
    await pipeline(body, fs.createWriteStream(destination));
    return;
  }

  if (typeof (body as any).transformToByteArray === "function") {
    const bytes = await (body as any).transformToByteArray();
    await fsPromises.writeFile(destination, Buffer.from(bytes));
    return;
  }

  if (typeof (body as any).arrayBuffer === "function") {
    const buffer = Buffer.from(await (body as any).arrayBuffer());
    await fsPromises.writeFile(destination, buffer);
    return;
  }

  if (Symbol.asyncIterator in Object(body)) {
    const chunks: Buffer[] = [];
    const iterable = body as unknown as AsyncIterable<unknown>;
    for await (const chunk of iterable) {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(String(chunk)));
      }
    }
    await fsPromises.writeFile(destination, Buffer.concat(chunks));
    return;
  }

  throw new Error("Unsupported S3 response body type");
}

export async function downloadS3Artifact(
  uri: string,
): Promise<DownloadedS3Artifact> {
  const { bucket, key } = parseS3Uri(uri);
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new Error(
      "Set AWS_REGION or AWS_DEFAULT_REGION to download builds from S3.",
    );
  }

  const client = new S3Client({ region });
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await client.send(command);

  const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  const fileName = key.split("/").filter(Boolean).pop() ?? "artifact";
  const destination = path.join(tmpDir, fileName);

  try {
    await writeBodyToFile(response.Body, destination);
  } catch (error) {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
    throw error;
  }

  return {
    filePath: destination,
    cleanup: async () => {
      await fsPromises.rm(tmpDir, { recursive: true, force: true });
    },
  };
}
