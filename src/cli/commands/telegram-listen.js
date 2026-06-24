import { runTelegramLongPollListener } from "../../app/telegram/listener.js";

export async function runTelegramListenCommand({
  cwd,
  args = [],
  loadConfigFn,
  executeSearchWorkflowFn,
  createTelegramClientFn,
  createOffsetStoreFn,
  sleepFn,
  signal,
  onLog,
} = {}) {
  return runTelegramLongPollListener({
    cwd,
    args,
    loadConfigFn,
    executeSearchWorkflowFn,
    createTelegramClientFn,
    createOffsetStoreFn,
    sleepFn,
    signal,
    onLog,
  });
}
