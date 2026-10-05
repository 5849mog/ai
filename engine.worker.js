// Classic worker: upstream Emscripten's factory is loaded with importScripts.
// The GUI and protocol-independent client remain native ES modules.
let instance;
let protocol;
let jobs;
let initialized = false;
let initError = false;
let loadedWeight = null;
let renju = false;
let forbiddenRequest = null;

function sendError(error) {
  initError = true;
  self.postMessage({ type: "error", message: error.message ?? String(error) });
}

function stdout(line) {
  if (forbiddenRequest !== null && line.startsWith("FORBID ")) {
    const coords = line.slice(7).replace(/\.$/, "").match(/\d{4}/g) ?? [];
    self.postMessage({ type: "forbids", requestId: forbiddenRequest, indices: coords.map(c => Number(c.slice(2)) * 15 + Number(c.slice(0, 2))) }); forbiddenRequest = null; return;
  }
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
  if (!jobs?.active) return;
  if (parsed.type === "move") {
    if (!(renju ? /mix9svqrenju_bs15_(black|white)\.bin\.lz4$/ : /mix9svqfreestyle_bsmix\.bin\.lz4$/).test(loadedWeight ?? "")) {
      sendError(new Error("未能确认指定的神经网络权重，请重试"));
      return;
    }
  }
  try { jobs.output(parsed, line); } catch (error) { sendError(error); }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      renju = data.rule !== undefined && data.rule !== "freestyle";
      protocol = await import("./engine-protocol.js");
      const { EngineJobs } = await import("./engine-jobs.js");
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
      if (renju) {
        const response = await fetch(new URL("manifest.json", data.modelURL));
        if (!response.ok) throw new Error("连珠模型清单加载失败");
        const manifest = await response.json();
        const entries = Object.entries(manifest.files), buffers = new Map();
        for (let offset = 0; offset < entries.length; offset += 6) {
          await Promise.all(entries.slice(offset, offset + 6).map(async ([name, expected]) => {
          if (!/^[a-z0-9_.-]+$/i.test(name)) throw new Error("连珠模型路径无效");
          const file = await fetch(new URL(name, data.modelURL));
          if (!file.ok) throw new Error("连珠模型加载失败");
          const bytes = new Uint8Array(await file.arrayBuffer());
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
          if (bytes.length !== expected.bytes || hash !== expected.sha256) throw new Error("连珠模型校验失败");
          buffers.set(name, bytes);
          }));
        }
        for (const model of manifest.models) {
          if (!/^[a-z0-9_.-]+$/i.test(model.name)) throw new Error("连珠权重路径无效");
          const bytes = new Uint8Array(model.bytes); let offset = 0;
          for (const part of model.parts) { const data = buffers.get(part); if (!data) throw new Error("连珠权重分片缺失"); bytes.set(data, offset); offset += data.length; }
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
          if (offset !== model.bytes || hash !== model.sha256) throw new Error("连珠完整权重校验失败");
          instance.FS_createDataFile("/", model.name, bytes, true, false, true);
        }
        instance.FS_unlink("/config.toml");
        instance.FS_createDataFile("/", "config.toml", buffers.get("config.toml"), true, false, true);
        instance.sendCommand("RELOADCONFIG /config.toml");
      }
      jobs = new EngineJobs({
        onPonderSlice: result => { if (data.reportSlices) self.postMessage({ type: "ponder-slice", result }); },
        send: command => instance.sendCommand(command),
        searchCommands: protocol.searchCommands,
        emit: message => self.postMessage(message.type === "move"
          ? { ...message, result: { ...message.result, evaluator: "mix9svq", weight: loadedWeight } }
          : message),
        setTimer: (callback, delay) => setTimeout(() => {
          try { callback(); } catch (error) { sendError(error); }
        }, delay)
      });
      for (const command of [`INFO rule ${renju ? 4 : 0}`, `INFO max_memory ${data.memoryBytes}`,
        `INFO thread_num ${data.threads}`, "INFO pondering 0", "INFO usedatabase 0",
        "INFO show_detail 2", "START 15"]) instance.sendCommand(command);
    } else if (data.type === "search") {
      if (!initialized || !instance || !jobs) throw new Error("引擎尚未准备好");
      jobs.search(data);
    } else if (data.type === "ponder") {
      if (!initialized || !instance || !jobs) throw new Error("引擎尚未准备好");
      jobs.ponder(data);
    } else if (data.type === "stop-ponder") {
      jobs?.stopPonder();
    } else if (data.type === "forbids") {
      if (!initialized || jobs?.active || jobs?.background) throw new Error("禁手查询需要空闲引擎");
      forbiddenRequest = data.requestId;
      instance.sendCommand(protocol.boardCommand(data.board, 1, true).replace(/^BOARD/, "YXBOARD"));
      instance.sendCommand("YXSHOWFORBID");
    }
  } catch (error) { sendError(error); }
};
