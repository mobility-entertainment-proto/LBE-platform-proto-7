import fs from "node:fs";
import path from "node:path";
import guideAudioDefs from "../data/guide-audio.json" with { type: "json" };
import { saveGuideAudio } from "../server/azure-speech.js";

const rootDir = path.resolve(".");

for (const entry of guideAudioDefs) {
  const outputPath = path.resolve(rootDir, entry.file);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const { voice } = await saveGuideAudio(entry.text, outputPath);
  console.log(`Generated: ${entry.id} -> ${outputPath}`);
  console.log(`Voice: ${voice}`);
}
