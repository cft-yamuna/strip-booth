import fs from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const OUTPUT_DIR = path.resolve(process.cwd(), "output_images");
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function getTimestampedFilename() {
  return `photo-strip-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
}

async function readJsonBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_IMAGE_BYTES * 2) {
      throw new Error("Image payload is too large");
    }
  }

  return JSON.parse(body || "{}");
}

function outputImageSaver() {
  return {
    name: "output-image-saver",
    configureServer(server) {
      server.middlewares.use("/api/save-output-image", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        try {
          const { imageData } = await readJsonBody(req);
          const match = /^data:image\/png;base64,(.+)$/.exec(imageData || "");

          if (!match) {
            res.statusCode = 400;
            res.end("Expected a PNG data URL");
            return;
          }

          const imageBuffer = Buffer.from(match[1], "base64");
          if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
            res.statusCode = 413;
            res.end("Image is too large");
            return;
          }

          await fs.mkdir(OUTPUT_DIR, { recursive: true });
          const filename = getTimestampedFilename();
          await fs.writeFile(path.join(OUTPUT_DIR, filename), imageBuffer);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ filename, path: path.join("output_images", filename) }));
        } catch (error) {
          console.error("Could not save output image.", error);
          res.statusCode = 500;
          res.end("Could not save output image");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), outputImageSaver()],
});
