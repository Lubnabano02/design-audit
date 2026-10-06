/**
 * A small multipart/form-data reader.
 *
 * Only what a single-file upload form needs: text fields and one image. Written
 * here rather than pulled in, because a body parser is a lot of dependency for
 * one form, and this one never leaves localhost.
 */

const CRLF = Buffer.from('\r\n');
const DASH = Buffer.from('--');

function indexOfFrom(haystack, needle, from) {
  const i = haystack.indexOf(needle, from);
  return i === -1 ? haystack.length : i;
}

/** Collect the request body, refusing anything oversized. */
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error(`That upload is larger than ${Math.round(maxBytes / 1e6)}MB.`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * @param {Buffer} body
 * @param {string} contentType  the full header, including boundary
 * @returns {{fields: Record<string,string>, files: Record<string,{filename:string,type:string,data:Buffer}>}}
 */
export function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('That form submission was malformed (no boundary).');
  const boundary = Buffer.from('--' + (m[1] ?? m[2]).trim());

  const fields = {};
  const files = {};

  let pos = body.indexOf(boundary);
  if (pos === -1) return { fields, files };
  pos += boundary.length;

  while (pos < body.length) {
    // "--" straight after a boundary means the end of the body.
    if (body.slice(pos, pos + 2).equals(DASH)) break;
    pos += CRLF.length;

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headers = body.slice(pos, headerEnd).toString('utf8');
    const start = headerEnd + 4;

    const next = indexOfFrom(body, boundary, start);
    // Trim the CRLF that precedes the next boundary.
    const end = Math.max(start, next - CRLF.length);
    const content = body.slice(start, end);

    const nameMatch = /name="([^"]*)"/i.exec(headers);
    const fileMatch = /filename="([^"]*)"/i.exec(headers);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headers);
    const name = nameMatch?.[1];

    if (name) {
      if (fileMatch && fileMatch[1]) {
        files[name] = { filename: fileMatch[1], type: (typeMatch?.[1] ?? '').trim(), data: content };
      } else if (!fileMatch) {
        fields[name] = content.toString('utf8');
      }
    }
    pos = next + boundary.length;
  }

  return { fields, files };
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

/** Turn an uploaded image into a data URI, or explain why not. */
export function imageToDataUri(file) {
  if (!file || !file.data?.length) throw new Error('No image was uploaded.');
  const type = (file.type || '').toLowerCase();
  if (!IMAGE_TYPES.has(type)) {
    throw new Error(`That file is a ${type || 'unknown type'}. Upload a PNG, JPEG, WebP, GIF or AVIF.`);
  }
  return `data:${type};base64,${file.data.toString('base64')}`;
}
