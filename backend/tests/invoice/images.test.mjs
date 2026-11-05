import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { prepareInvoiceFile, sniffType } from "../../src/invoice/images.js";

const tmp = (ext) => join(tmpdir(), `invoice-image-${randomUUID()}.${ext}`);

// A landscape JPEG (red left edge) carrying EXIF Orientation 6 = "rotate 90 degrees clockwise".
async function exifRotatedJpeg(width = 400, height = 200) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f00";
  ctx.fillRect(0, 0, width / 4, height);
  const jpeg = await canvas.encode("jpeg", 90);
  const exif = Buffer.from([0xff, 0xe1, 0, 34, ...Buffer.from("Exif\0\0"), 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
}

test("invoice images: EXIF orientation is applied exactly once; the rotate button adds to it", async () => {
  const path = tmp("jpg");
  await writeFile(path, await exifRotatedJpeg());
  try {
    const upright = await prepareInvoiceFile(path);
    assert.equal(upright.kind, "images");
    assert.deepEqual([upright.images[0].width, upright.images[0].height], [200, 400], "portrait, not rotated twice");
    // After the EXIF turn the red edge is at the top.
    const image = await loadImage(upright.images[0].data);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    const [r, g] = canvas.getContext("2d").getImageData(100, 10, 1, 1).data;
    assert.ok(r > 200 && g < 80, "red edge on top");

    const turned = await prepareInvoiceFile(path, { rotate: 90 });
    assert.deepEqual([turned.images[0].width, turned.images[0].height], [400, 200]);
  } finally {
    await rm(path, { force: true });
  }
});

test("invoice images: large photos are downscaled to a 2000px long side; unknown files are refused", async () => {
  const canvas = createCanvas(3000, 1500);
  const path = tmp("png");
  await writeFile(path, await canvas.encode("png"));
  try {
    const result = await prepareInvoiceFile(path);
    assert.deepEqual([result.images[0].width, result.images[0].height, result.images[0].mediaType], [2000, 1000, "image/jpeg"]);
  } finally {
    await rm(path, { force: true });
  }
  assert.equal(sniffType(Buffer.from("not an image")), null);
  const text = tmp("pdf");
  await writeFile(text, "hello");
  try {
    await assert.rejects(prepareInvoiceFile(text), { code: "INVOICE_UNSUPPORTED_FILE" });
  } finally {
    await rm(text, { force: true });
  }
});
