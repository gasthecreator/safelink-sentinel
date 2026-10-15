// app/services/maps/rnfsAdapter.js
// PackStore's file access, on a real phone, using react-native-fs.

import RNFS from "react-native-fs";

const root = `${RNFS.DocumentDirectoryPath}/map-packs`;

async function exists(p) {
  return RNFS.exists(p);
}

export default {
  root,
  exists,
  mkdirp: (p) => RNFS.mkdir(p),
  readText: (p) => RNFS.readFile(p, "utf8"),
  writeText: (p, text) => RNFS.writeFile(p, text, "utf8"),
  async move(from, to) {
    if (await exists(to)) await RNFS.unlink(to);
    await RNFS.moveFile(from, to);
  },
  async remove(p) {
    if (await exists(p)) await RNFS.unlink(p);
  },
  async list(dir) {
    return (await RNFS.readDir(dir)).map((f) => f.name);
  },
  async size(p) {
    return Number((await RNFS.stat(p)).size);
  },
  sha256: (p) => RNFS.hash(p, "sha256"), // computed natively, so a large file is not read into JavaScript
  async freeBytes() {
    return Number((await RNFS.getFSInfo()).freeSpace);
  },
  /** Starts a download and returns { done: Promise, cancel() }. Redirects are followed. */
  download({ url, to, onProgress }) {
    let cancelled = false;
    const job = RNFS.downloadFile({
      fromUrl: url,
      toFile: to,
      background: false,
      progressInterval: 250,
      progress: (p) => onProgress && onProgress({ bytes: p.bytesWritten, total: p.contentLength }),
    });
    const done = job.promise.then((result) => {
      if (cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
      if (result.statusCode !== 200) throw new Error(`the server answered ${result.statusCode}`);
      return { bytes: result.bytesWritten };
    }, (err) => {
      if (cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
      throw err;
    });
    return {
      done,
      cancel() {
        cancelled = true;
        RNFS.stopDownload(job.jobId);
      },
    };
  },
};
