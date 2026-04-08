import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { NormalizedMessage } from "./types.js";

interface PersistedTriageState {
  version: 1;
  notifiedMessageIds: string[];
}

export interface TriageStateOptions {
  path?: string;
  suppressRead?: boolean;
  suppressPreviouslyNotified?: boolean;
}

export interface LoadedTriageState {
  enabled: boolean;
  path: string;
  suppressRead: boolean;
  suppressPreviouslyNotified: boolean;
  notifiedMessageIds: Set<string>;
}

export interface FilteredMessages {
  messages: NormalizedMessage[];
  suppressedReadCount: number;
  suppressedPreviouslyNotifiedCount: number;
}

const DEFAULT_STATE_PATH = resolve(homedir(), ".config", "flowmesh", "triage-state.json");

export async function loadTriageState(
  options: TriageStateOptions = {}
): Promise<LoadedTriageState> {
  const enabled = Boolean(options.path);
  const path = resolve(options.path ?? DEFAULT_STATE_PATH);
  const suppressRead = options.suppressRead ?? true;
  const suppressPreviouslyNotified = options.suppressPreviouslyNotified ?? true;

  if (!enabled) {
    return {
      enabled,
      path,
      suppressRead: false,
      suppressPreviouslyNotified: false,
      notifiedMessageIds: new Set<string>(),
    };
  }

  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistedTriageState>;
    return {
      enabled,
      path,
      suppressRead,
      suppressPreviouslyNotified,
      notifiedMessageIds: new Set(parsed.notifiedMessageIds ?? []),
    };
  } catch {
    return {
      enabled,
      path,
      suppressRead,
      suppressPreviouslyNotified,
      notifiedMessageIds: new Set<string>(),
    };
  }
}

export function filterMessagesWithState(
  messages: NormalizedMessage[],
  state: LoadedTriageState
): FilteredMessages {
  if (!state.enabled) {
    return {
      messages,
      suppressedReadCount: 0,
      suppressedPreviouslyNotifiedCount: 0,
    };
  }

  let suppressedReadCount = 0;
  let suppressedPreviouslyNotifiedCount = 0;

  const filtered = messages.filter((message) => {
    if (state.suppressRead && message.flags.read) {
      suppressedReadCount += 1;
      return false;
    }

    if (
      state.suppressPreviouslyNotified &&
      state.notifiedMessageIds.has(message.id)
    ) {
      suppressedPreviouslyNotifiedCount += 1;
      return false;
    }

    return true;
  });

  return {
    messages: filtered,
    suppressedReadCount,
    suppressedPreviouslyNotifiedCount,
  };
}

export async function persistTriageState(
  state: LoadedTriageState,
  messages: NormalizedMessage[]
): Promise<void> {
  if (!state.enabled) return;

  const next = new Set(state.notifiedMessageIds);
  for (const message of messages) {
    next.add(message.id);
  }

  const payload: PersistedTriageState = {
    version: 1,
    notifiedMessageIds: Array.from(next).sort(),
  };

  await mkdir(dirname(state.path), { recursive: true });
  await writeFile(state.path, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}
