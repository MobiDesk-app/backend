import type { ServerMessage } from "../types/messages";
import type { Connection, ConnectionHub } from "./connectionHub";
import type { Store } from "../store/store";

/** Everything a message handler needs, without reaching for globals/singletons. */
export interface HandlerContext {
  conn: Connection;
  hub: ConnectionHub;
  store: Store;
  send: (message: ServerMessage) => void;
}
