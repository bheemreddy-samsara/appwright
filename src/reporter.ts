import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { getProviderClass } from "./providers";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { logger } from "./logger";
import { basePath } from "./utils";
import { WorkerInfo, WorkerInfoStore } from "./fixture/workerInfo";

class VideoDownloader implements Reporter {
  private downloadPromises: Promise<any>[] = [];
  // Ensures only one download per session — prevents concurrent downloads
  // when multiple tests on the same worker resolve endTime simultaneously.
  // Keyed by sessionId (not workerIndex) because Playwright can reuse
  // workerIndex across worker restarts with different sessions.
  private sessionDownloadLocks = new Map<string, Promise<string | null>>();

  onBegin() {
    if (fs.existsSync(basePath())) {
      fs.rmSync(basePath(), {
        recursive: true,
      });
    }
  }

  onTestBegin(test: TestCase, result: TestResult) {
    logger.log(`Starting test: ${test.title} on worker ${result.workerIndex}`);
    const workerInfoStore = new WorkerInfoStore();
    void workerInfoStore.saveTestStartTime(
      result.workerIndex,
      test.title,
      new Date(),
    );
  }

  onTestEnd(test: TestCase, result: TestResult) {
    logger.log(`Ending test: ${test.title} on worker ${result.workerIndex}`);
    const sessionIdAnnotation = test.annotations.find(
      ({ type }) => type === "sessionId",
    );
    const providerNameAnnotation = test.annotations.find(
      ({ type }) => type === "providerName",
    );
    // Check if test ran on `device` or on `persistentDevice`
    const isTestUsingDevice = sessionIdAnnotation && providerNameAnnotation;
    if (isTestUsingDevice) {
      // This is a test that ran with the `device` fixture
      const sessionId = sessionIdAnnotation.description;
      const providerName = providerNameAnnotation.description;
      if (this.providerSupportsVideo(providerName!)) {
        const provider = getProviderClass(providerName!);
        this.downloadAndAttachDeviceVideo(test, result, provider, sessionId!);
      }
      const otherAnnotations = test.annotations.filter(
        ({ type }) => type !== "sessionId" && type !== "providerName",
      );
      test.annotations = otherAnnotations;
    } else {
      // This is a test that ran on `persistentDevice` fixture
      const { workerIndex, duration } = result;
      if (duration <= 0) {
        // Skipped tests
        return;
      }
      test.annotations.push({
        type: "workerInfo",
        description: `Ran on worker #${workerIndex}.`,
      });
      // The `onTestEnd` method is called before the worker ends and
      // the worker's `endTime` is saved to disk. We add a 5 secs delay
      // to prevent a harmful race condition.
      const workerDownload = getWorkerInfo(workerIndex)
        .then((initialWorkerInfo) => {
          const providerName = initialWorkerInfo?.providerName;
          if (providerName && !this.providerSupportsVideo(providerName)) {
            return;
          }
          return waitFiveSeconds()
            .then(() => getWorkerInfo(workerIndex))
            .then(async (workerInfo) => {
              if (!workerInfo) {
                throw new Error(
                  `Worker info not found for idx: ${workerIndex}`,
                );
              }
              const { providerName, sessionId, endTime } = workerInfo;
              if (!providerName || !sessionId) {
                logger.log(
                  `No provider/session for worker ${workerIndex}, skipping video`,
                );
                return;
              }
              if (!this.providerSupportsVideo(providerName)) {
                return; // Nothing to do here
              }
              const workerVideoBaseName = `worker-${workerIndex}-${sessionId}-video`;
              const expectedWorkerVideoPath = path.join(
                basePath(),
                `${workerVideoBaseName}.mp4`,
              );
              if (endTime) {
                // Last test in the worker — download through the lock
                // so concurrent endTime resolutions don't race.
                const downloadedPath = await this.ensureWorkerVideoDownloaded(
                  sessionId,
                  providerName,
                  workerVideoBaseName,
                );
                if (!downloadedPath) {
                  return;
                }
                return this.trimAndAttachPersistentDeviceVideo(
                  test,
                  result,
                  downloadedPath,
                );
              } else {
                // This looks like an intermediate test, but endTime may not
                // have been written yet (race condition — common when a worker
                // has only one test, e.g. retries). Poll for EITHER the video
                // file on disk (written by the last test's download) OR
                // endTime appearing (meaning we need to download ourselves).
                const resolved = await waitForFileOrEndTime(
                  expectedWorkerVideoPath,
                  workerIndex,
                );
                if (resolved === "file") {
                  return this.trimAndAttachPersistentDeviceVideo(
                    test,
                    result,
                    expectedWorkerVideoPath,
                  );
                } else {
                  // endTime was set but file doesn't exist yet. Use the
                  // per-session lock so only one test triggers the download;
                  // others await the same promise.
                  const downloadedPath = await this.ensureWorkerVideoDownloaded(
                    sessionId,
                    providerName,
                    workerVideoBaseName,
                  );
                  if (!downloadedPath) {
                    logger.error(
                      `Video download returned null for session ${sessionId}, skipping attachment`,
                    );
                    return;
                  }
                  return this.trimAndAttachPersistentDeviceVideo(
                    test,
                    result,
                    downloadedPath,
                  );
                }
              }
            });
        })
        .catch((e) => {
          logger.error("Failed to get worker end time:", e);
        });
      this.downloadPromises.push(workerDownload);
    }
  }

  async onEnd() {
    logger.log(`Triggered onEnd`);
    await Promise.allSettled(this.downloadPromises);
  }

  private async trimAndAttachPersistentDeviceVideo(
    test: TestCase,
    result: TestResult,
    workerVideoPath: string,
  ) {
    const workerIdx = result.workerIndex;
    const workerStart = await getWorkerStartTime(workerIdx);
    let pathToAttach = workerVideoPath;
    const testStart = result.startTime;
    if (testStart.getTime() < workerStart.getTime()) {
      // This is the first test for the worker
      // The startTime for the first test in the worker tends to be
      // before worker (session) start time. This would have been manageable
      // if the `duration` included the worker setup time, but the duration only
      // covers the test method execution time.
      // So in this case, we are not going to trim.
      // TODO: We can use the startTime of the second test in the worker
      pathToAttach = workerVideoPath;
    } else {
      const trimSkipPoint =
        (testStart.getTime() - workerStart.getTime()) / 1000;
      const retryIndex = result.retry ?? 0;
      const trimmedFileName = `worker-${workerIdx}-trimmed-${test.id}-retry-${retryIndex}.mp4`;
      try {
        pathToAttach = await trimVideo({
          originalVideoPath: workerVideoPath,
          startSecs: trimSkipPoint,
          durationSecs: result.duration / 1000,
          outputPath: trimmedFileName,
        });
      } catch (e) {
        logger.error("Failed to trim video:", e);
        test.annotations.push({
          type: "videoError",
          description: `Unable to trim video, attaching full video instead. Test starts at ${trimSkipPoint} secs.`,
        });
      }
    }
    result.attachments.push({
      path: pathToAttach,
      contentType: "video/mp4",
      name: "video",
    });
  }

  /**
   * Ensures exactly one download per session. The first caller triggers the
   * download; concurrent callers await the same promise. Returns the
   * downloaded file path, or null if the download failed.
   *
   * Keyed by sessionId (not workerIndex) because Playwright can reuse
   * workerIndex across worker restarts with different BrowserStack sessions.
   */
  private async ensureWorkerVideoDownloaded(
    sessionId: string,
    providerName: string,
    workerVideoBaseName: string,
  ): Promise<string | null> {
    if (!this.sessionDownloadLocks.has(sessionId)) {
      const downloadPromise = (async () => {
        const provider = getProviderClass(providerName);
        const downloaded: { path: string; contentType: string } | null =
          await provider.downloadVideo(
            sessionId,
            basePath(),
            workerVideoBaseName,
          );
        return downloaded?.path ?? null;
      })();
      this.sessionDownloadLocks.set(sessionId, downloadPromise);
    }
    return this.sessionDownloadLocks.get(sessionId)!;
  }

  private downloadAndAttachDeviceVideo(
    test: TestCase,
    result: TestResult,
    providerClass: any,
    sessionId: string,
  ) {
    const videoFileName = `${sessionId}-${test.id}`;
    if (!providerClass.downloadVideo) {
      return;
    }
    const downloadPromise = providerClass
      .downloadVideo(sessionId, basePath(), videoFileName)
      .then((downloadedVideo: { path: string; contentType: string } | null) => {
        if (!downloadedVideo) {
          return;
        }
        result.attachments.push({
          ...downloadedVideo,
          name: "video",
        });
        return downloadedVideo;
      });
    this.downloadPromises.push(downloadPromise);
  }

  private providerSupportsVideo(providerName: string) {
    if (
      providerName === "browserstack" &&
      process.env.APPWRIGHT_DISABLE_VIDEO_DOWNLOAD === "true"
    ) {
      return false;
    }
    const provider = getProviderClass(providerName);
    return !!provider.downloadVideo;
  }
}

/**
 * Poll until the video file appears on disk OR the worker's endTime is set.
 *
 * When a worker has only one test (common with retries), the 5-second delay
 * before checking endTime may not be enough — the worker teardown can take
 * longer than 5 seconds. In that case onTestEnd
 * incorrectly treats the last test as "intermediate" and waits for a video file
 * that will never be created. This function resolves the race by checking both
 * conditions in parallel.
 *
 * Uses validateMp4 instead of fs.existsSync to ensure the file is fully
 * written (has a valid moov atom) before returning.
 */
async function waitForFileOrEndTime(
  filePath: string,
  workerIndex: number,
  timeout: number = 5 * 60 * 1000, // 5 minutes
): Promise<"file" | "endTime"> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && validateMp4(filePath)) {
      return "file";
    }
    try {
      const info = await getWorkerInfo(workerIndex);
      if (info?.endTime) {
        return "endTime";
      }
    } catch {
      // getWorkerInfo can fail transiently; keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Timed out waiting for video file or worker ${workerIndex} endTime`,
  );
}

/**
 * Validate that an MP4 file has a valid moov atom (metadata header).
 * BrowserStack videos can be incomplete if downloaded before finalization,
 * resulting in a missing moov atom that causes ffmpeg to fail.
 */
function validateMp4(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const stat = fs.fstatSync(fd);
    const moovMarker = Buffer.from("moov");
    const chunkSize = Math.min(stat.size, 128 * 1024);

    // Check the beginning (fast-start MP4s place moov before mdat)
    const head = Buffer.alloc(chunkSize);
    fs.readSync(fd, head, 0, chunkSize, 0);
    if (head.includes(moovMarker)) {
      fs.closeSync(fd);
      return true;
    }

    // Check the end (standard MP4s place moov after mdat)
    if (stat.size > chunkSize) {
      const tail = Buffer.alloc(chunkSize);
      fs.readSync(fd, tail, 0, chunkSize, stat.size - chunkSize);
      fs.closeSync(fd);
      return tail.includes(moovMarker);
    }

    fs.closeSync(fd);
    return false;
  } catch {
    return false;
  }
}

function trimVideo({
  originalVideoPath,
  startSecs,
  durationSecs,
  outputPath,
}: {
  originalVideoPath: string;
  startSecs: number;
  durationSecs: number;
  outputPath: string;
}): Promise<string> {
  logger.log(
    `Attemping to trim video: ${originalVideoPath} at start: ${startSecs} and duration: ${durationSecs} to ${outputPath}`,
  );

  if (!validateMp4(originalVideoPath)) {
    throw new Error(
      `Video file is incomplete or corrupt (missing moov atom): ${originalVideoPath}`,
    );
  }

  const copyName = `draft-for-${outputPath}`;
  const dirPath = path.dirname(originalVideoPath);
  const copyFullPath = path.join(dirPath, copyName);
  const fullOutputPath = path.join(dirPath, outputPath);
  fs.copyFileSync(originalVideoPath, copyFullPath);
  return new Promise((resolve, reject) => {
    let stdErrs = "";
    ffmpeg(copyFullPath)
      .setFfmpegPath(ffmpegInstaller.path)
      .setStartTime(startSecs)
      .setDuration(durationSecs)
      .output(fullOutputPath)
      .on("end", () => {
        logger.log(`Trimmed video saved at: ${fullOutputPath}`);
        fs.unlinkSync(copyFullPath);
        resolve(fullOutputPath);
      })
      .on("stderr", (stderrLine) => {
        stdErrs += stderrLine + "\n";
      })
      .on("error", (err) => {
        logger.error("ffmpeg error:", err);
        logger.error("ffmpeg stderr:", stdErrs);
        reject(err);
      })
      .run();
  });
}

async function getWorkerStartTime(idx: number): Promise<Date> {
  const workerInfoStore = new WorkerInfoStore();
  return workerInfoStore.getWorkerStartTime(idx);
}

async function getWorkerInfo(idx: number): Promise<WorkerInfo | undefined> {
  const workerInfoStore = new WorkerInfoStore();
  return workerInfoStore.getWorkerFromDisk(idx);
}

const waitFiveSeconds = () =>
  new Promise((resolve) => setTimeout(resolve, 5000));

export default VideoDownloader;
