(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.pause = function pause() {};
  HTMLMediaElement.prototype.play = async function play() {};
}
if (typeof HTMLCanvasElement !== "undefined" && !HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

if (typeof URL !== "undefined" && typeof URL.createObjectURL !== "function") {
  const urls = new Map<string, Blob>();
  let n = 0;
  URL.createObjectURL = (blob: Blob) => {
    n += 1;
    const url = "blob:v5-test:" + n;
    urls.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    urls.delete(url);
  };
}
