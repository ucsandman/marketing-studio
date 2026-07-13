// Magnetic sidecar client — talks to a running Magnetic editor's Agent Access
// loopback HTTP bridge. Mirrors discover()/callSidecar() from
// C:\projects\final-cut-pro\scripts\magnetic-mcp.mjs (lines 23-66) EXACTLY —
// same env-var precedence, same discovery-file lookup, same error message
// text — so operators see identical hints whether they're going through an
// MCP client or this repo's review-reel driver. That file is a read-only
// reference in a separate repo, not imported; the logic is duplicated here on
// purpose per the task brief.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// Env vars win outright (both must be set); otherwise the editor's discovery
// file, checked under both casings Magnetic may write
// (%APPDATA%/magnetic/agent-sidecar.json, or "Magnetic" when packaged).
export function discoverSidecar() {
  const {MAGNETIC_AGENT_PORT, MAGNETIC_AGENT_TOKEN} = process.env;
  if (MAGNETIC_AGENT_PORT !== undefined && MAGNETIC_AGENT_TOKEN !== undefined) {
    return {port: Number(MAGNETIC_AGENT_PORT), token: MAGNETIC_AGENT_TOKEN};
  }
  const appData = process.env.APPDATA ?? join(process.env.HOME ?? '', 'Library', 'Application Support');
  for (const name of ['magnetic', 'Magnetic']) {
    try {
      const parsed = JSON.parse(readFileSync(join(appData, name, 'agent-sidecar.json'), 'utf8'));
      if (typeof parsed.port === 'number' && typeof parsed.token === 'string') return parsed;
    } catch {
      // keep looking
    }
  }
  return null;
}

// POST http://127.0.0.1:<port>/tool, bearer token, body {tool, input}.
// Response is {result} on success or {error} on rejection (whole-call reject,
// e.g. import_media naming an out-of-allowlist path). Error text mirrors the
// MCP bridge verbatim.
export async function callTool(tool, input) {
  const config = discoverSidecar();
  if (config === null) {
    throw new Error(
      'Magnetic is not reachable — open the editor and enable Agent Access in the sidebar (or set MAGNETIC_AGENT_PORT / MAGNETIC_AGENT_TOKEN).'
    );
  }
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/tool`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({tool, input}),
    });
  } catch {
    throw new Error('Magnetic refused the connection — Agent Access is switched off.');
  }
  const payload = await response.json();
  if (!response.ok || payload.error !== undefined) {
    throw new Error(payload.error ?? `sidecar answered HTTP ${response.status}`);
  }
  return payload.result;
}
