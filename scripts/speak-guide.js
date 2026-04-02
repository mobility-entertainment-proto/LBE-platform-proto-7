import { speakGuide } from "../server/azure-speech.js";

const text =
  process.argv.slice(2).join(" ").trim() ||
  "今日はお台場の日本科学未来館へ向かいます。";

try {
  const { outputPath, voice } = await speakGuide(text);
  console.log(`Guide audio saved: ${outputPath}`);
  console.log(`Voice: ${voice}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
