import fs from "fs";

/**
 * Validate that an MP4 file has a valid moov atom (metadata header).
 * BrowserStack videos can be incomplete if downloaded before finalization,
 * resulting in a missing moov atom that causes ffmpeg to fail.
 */
export function validateMp4(filePath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const stat = fs.fstatSync(fd);
    const moovMarker = Buffer.from("moov");
    const chunkSize = Math.min(stat.size, 128 * 1024);

    // Check the beginning (fast-start MP4s place moov before mdat)
    const head = Buffer.alloc(chunkSize);
    fs.readSync(fd, head, 0, chunkSize, 0);
    if (head.includes(moovMarker)) {
      return true;
    }

    // Check the end (standard MP4s place moov after mdat)
    if (stat.size > chunkSize) {
      const tail = Buffer.alloc(chunkSize);
      fs.readSync(fd, tail, 0, chunkSize, stat.size - chunkSize);
      return tail.includes(moovMarker);
    }

    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // already failing
      }
    }
  }
}
