/// <reference lib="webworker" />
import { runEngineSync, type EngineJob } from "./runEngine";

self.onmessage = (event: MessageEvent<{ id: number; job: EngineJob }>) => {
  const { id, job } = event.data;
  try {
    const records = runEngineSync(job);
    (self as unknown as Worker).postMessage({ id, records });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
