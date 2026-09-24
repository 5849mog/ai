import { chooseMove } from "./engine.js";

self.addEventListener("message", event => {
  const data = event.data;
  try {
    const result = chooseMove(data.board, data.level);
    self.postMessage({ type: "move", requestId: data.requestId, result });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: data.requestId,
      message: error instanceof Error ? error.message : "Engine error"
    });
  }
});
