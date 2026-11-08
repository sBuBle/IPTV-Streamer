// hls.js is ~400 kB, so it is only downloaded when a stream is actually played.
let hlsPromise = null;

export function loadHls() {
  if (!hlsPromise) {
    hlsPromise = import('hls.js')
      .then((mod) => mod.default)
      .catch((err) => {
        hlsPromise = null;
        throw err;
      });
  }
  return hlsPromise;
}
