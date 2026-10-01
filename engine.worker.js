// Classic worker: upstream Emscripten's factory is loaded with importScripts.
// The GUI and protocol-independent client remain native ES modules.
let instance;
let protocol;
let active = null;
let initialized = false;
let initError = false;
let loadedWeight = null;

function sendError(error) {
  initError = true;
  self.postMessage({ type: "error", requestId: active?.requestId, message: error.message ?? String(error) });
}

function stdout(line) {
  if (!protocol) return;
  if (/Evaluator .* disabled:/i.test(line)) {
    sendError(new Error("神经网络权重未能启用，请重试"));
    return;
  }
  const weight = /mix9svq nnue: load weight from (.+)/.exec(line);
  if (weight) loadedWeight = weight[1].trim();
  const parsed = protocol.parseOutput(line);
  if (parsed.type === "error") { sendError(new Error(parsed.message)); return; }
  if (parsed.type === "ok" && !initialized) {
    initialized = true;
    if (!initError) self.postMessage({ type: "ready" });
    return;
  }
  if (!active) return;
  if (parsed.type === "stats") {
    active.stats = { ...active.stats, ...parsed.stats };
    self.postMessage({ type: "stats", requestId: active.requestId, stats: parsed.stats });
  } else if (parsed.type === "move") {
    if (!loadedWeight?.endsWith("mix9svqfreestyle_bsmix.bin.lz4")) {
      sendError(new Error("未能确认指定的神经网络权重，请重试"));
      return;
    }
    const job = active;
    active = null;
    self.postMessage({ type: "move", requestId: job.requestId,
      result: { ...job.stats, index: parsed.index, x: parsed.x, y: parsed.y,
        elapsed: Math.round(performance.now() - job.started),
        evaluator: "mix9svq", weight: loadedWeight } });
  }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      protocol = await import("./engine-protocol.js");
      const script = new URL(`${data.variant}.js`, data.baseURL).href;
      self.importScripts(script);
      instance = await self.Rapfi({
        mainScriptUrlOrBlob: script,
        locateFile: file => new URL(file.endsWith(".data") ? "rapfi.data" : file, data.baseURL).href,
        wasmMemory: new WebAssembly.Memory({ initial: 1024, maximum: 16384, shared: data.variant.includes("multi") }),
        onReceiveStdout: stdout,
        onReceiveStderr: line => { if (/failed|error|abort/i.test(line)) sendError(new Error(line)); },
        onAbort: message => sendError(new Error(message)),
        onExit: code => { if (code) sendError(new Error(`引擎退出 (${code})`)); },
        setStatus: status => {
          const progress = /\((\d+)\/(\d+)\)/.exec(status);
          if (progress) self.postMessage({ type: "loading", progress: Number(progress[1]) / Number(progress[2]) });
        }
      });
      for (const command of ["INFO rule 0", `INFO max_memory ${data.memoryBytes}`,
        `INFO thread_num ${data.threads}`, "INFO pondering 0", "INFO usedatabase 0",
        "INFO show_detail 2", "START 15"]) instance.sendCommand(command);
    } else if (data.type === "search") {
      if (!initialized || !instance || active) throw new Error("引擎尚未准备好");
      const commands = protocol.searchCommands(data.board, data.sideToMove, data.timeMs);
      active = { requestId: data.requestId, started: performance.now(), stats: {} };
      for (const command of commands) instance.sendCommand(command);
    }
  } catch (error) { sendError(error); }
};
