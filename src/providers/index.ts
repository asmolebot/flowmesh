/**
 * Provider registration — imports all adapters and registers them.
 */

import { registerProvider } from "../core/provider.js";
import { GogAdapter } from "./gog.js";
import { ImapAdapter } from "./imap.js";
import { HimalayaAdapter } from "./himalaya.js";

export function registerAllProviders(): void {
  registerProvider(new GogAdapter());
  registerProvider(new ImapAdapter());
  registerProvider(new HimalayaAdapter());
}
