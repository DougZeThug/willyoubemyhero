// The `server.handlers` option on a file route is declaration-merged in by
// @tanstack/start-client-core. Route files import only @tanstack/react-router,
// so nothing pulls that augmentation into the program — including the MCP
// routes the Vite plugin generates. This side-effect import loads it globally.
import "@tanstack/start-client-core";
