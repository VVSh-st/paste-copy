# Backup note

Affected file: `llm-core.js`.

Before editing, relevant sections were read with `read`, and the full file was fetched through Browser MCP via `file:///E:/Cherry_studio/llm-core.js` (length: 86094 chars). Native copy access to `E:\Cherry_studio` from Python/Pyodide is unavailable in this environment, so a full filesystem-native copy could not be produced automatically.

Reason for change: `http://31.76.245.89:20128/v1/models` is reachable without Authorization, but returns 401 with an invalid `Authorization: Bearer ...`; model loading in the project always sent the saved key, so an invalid/stale key could break model listing even though the catalog is public. The fix retries model catalog loading without Authorization for OpenAI Responses API while keeping real chat/probe requests authenticated.
