/**
 * Fichier PDF à télécharger, sans librairie : chaque page du document
 * d'impression est dessinée sur un canvas (200 dpi) puis posée en JPEG pleine
 * page dans un PDF minimal. Le texte n'est donc pas sélectionnable.
 */
const DPI = 200;
const PX_PER_MM = 96 / 25.4;

function pageImage(section: Element, css: string, wMm: number, hMm: number): Promise<HTMLCanvasElement> {
  const w = Math.round(wMm * PX_PER_MM);
  const h = Math.round(hMm * PX_PER_MM);
  const body = new XMLSerializer().serializeToString(section);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="pw"><style>${css}</style>${body}</div></foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((wMm / 25.4) * DPI);
      canvas.height = Math.round((hMm / 25.4) * DPI);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => (reject(new Error('Une page n\'a pas pu être dessinée.')));
    img.src = url;
  });
}

const toJpeg = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('Encodage JPEG impossible.'))), 'image/jpeg', 0.92),
  );

export async function htmlToPdf(html: string, wMm: number, hMm: number): Promise<Blob> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const css = (doc.querySelector('style')?.textContent ?? '').replace(/\bhtml, body\b/, '.pw').replace(/\bbody \{/, '.pw {');
  const sections = Array.from(doc.querySelectorAll('section.page'));
  const ptW = ((wMm / 25.4) * 72).toFixed(2);
  const ptH = ((hMm / 25.4) * 72).toFixed(2);

  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b;
    parts.push(u);
    size += u.length;
  };
  const obj = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = size;
    push(`${n} 0 obj\n${body}`);
    if (stream) (push('\nstream\n'), push(stream), push('\nendstream'));
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${sections.length} /Kids [${sections.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  for (let i = 0; i < sections.length; i++) {
    const canvas = await pageImage(sections[i], css, wMm, hMm);
    const jpeg = await toJpeg(canvas);
    const page = 3 + i * 3;
    const draw = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    obj(page + 1, `<< /Length ${draw.length} >>`, enc.encode(draw));
    obj(page + 2, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  }
  const count = 3 + sections.length * 3;
  const xref = size;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
