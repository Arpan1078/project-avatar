const fs = require("node:fs");
const path = require("node:path");

const token = process.env.CESIUM_ION_TOKEN?.trim();

if (!token || token === "PASTE_YOUR_TOKEN_HERE") {
  throw new Error(
    "Missing CESIUM_ION_TOKEN. Set it in Vercel environment variables, then redeploy."
  );
}

const outputPath = path.join(__dirname, "config.js");

fs.writeFileSync(
  outputPath,
  `window.CESIUM_ION_TOKEN = ${JSON.stringify(token)};\n`,
  "utf8"
);

console.log("Generated config.js");