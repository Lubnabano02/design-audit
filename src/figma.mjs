/**
 * Minimal Figma REST client: fetch a frame's rendered image so it can sit beside
 * the build capture. Credentials come from the environment, never from config.
 */
const API = 'https://api.figma.com/v1';

function requireCreds({ fileKey, token }) {
  if (!fileKey) throw new Error('No Figma file key. Set FIGMA_FILE_KEY, or figma.fileKey in your config.');
  if (!token) throw new Error('No Figma token. Set FIGMA_TOKEN (a personal access token).');
}

async function get(url, token) {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) throw new Error(`Figma API ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** Rendered PNG URLs for the given node ids. */
export async function frameImages(nodeIds, { fileKey, token, scale = 2 }) {
  requireCreds({ fileKey, token });
  const ids = nodeIds.join(',');
  const data = await get(`${API}/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=${scale}`, token);
  if (data.err) throw new Error(`Figma render failed: ${data.err}`);
  return data.images ?? {};
}

/** Node metadata — useful for reading the frame's own size and name. */
export async function frameMeta(nodeIds, { fileKey, token }) {
  requireCreds({ fileKey, token });
  const ids = nodeIds.join(',');
  const data = await get(`${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`, token);
  return data.nodes ?? {};
}

/** Download a rendered frame next to its build capture. */
export async function downloadFrame(nodeId, destPath, creds) {
  const fs = await import('node:fs/promises');
  const images = await frameImages([nodeId], creds);
  const url = images[nodeId];
  if (!url) throw new Error(`Figma returned no image for node ${nodeId}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download frame image: ${res.status}`);
  await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

/** Accepts a full Figma URL or a bare node id, returns the API form (1:2). */
export function normaliseNodeId(input) {
  if (!input) return null;
  const fromUrl = String(input).match(/node-id=([0-9]+)[-:]([0-9]+)/);
  if (fromUrl) return `${fromUrl[1]}:${fromUrl[2]}`;
  return String(input).replace('-', ':');
}
