import fs from "node:fs";
import path from "node:path";
import guideAudioDefs from "../data/guide-audio.json" with { type: "json" };
import { saveGuideAudio, saveGuideAudioSsml } from "../server/azure-speech.js";

const rootDir = path.resolve(".");

for (const entry of guideAudioDefs) {
  const outputPath = path.resolve(rootDir, entry.file);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const saver = entry.ssml ? saveGuideAudioSsml : saveGuideAudio;
  const source = entry.ssml || entry.text;
  const { voice } = await saver(source, outputPath);
  console.log(`Generated: ${entry.id} -> ${outputPath}`);
  console.log(`Voice: ${voice}`);
}
