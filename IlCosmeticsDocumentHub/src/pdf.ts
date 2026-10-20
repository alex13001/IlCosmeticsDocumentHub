/** Stamps the document code in the top-right corner of every page. Throws on encrypted / unreadable PDFs. */
export async function stampPdf(bytes: ArrayBuffer, code: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 8;
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const label = `${code}  ·  ${i + 1}/${pages.length}`;
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(label, size);
    const x = width - tw - 18;
    const y = height - 18;
    page.drawRectangle({
      x: x - 4,
      y: y - 3,
      width: tw + 8,
      height: size + 7,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.25, 0.25, 0.25),
      borderWidth: 0.5,
    });
    page.drawText(label, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
  });
  return doc.save();
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(bin);
}
