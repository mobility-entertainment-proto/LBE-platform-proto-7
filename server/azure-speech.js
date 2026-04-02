import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import sdk from "microsoft-cognitiveservices-speech-sdk";

dotenv.config({ path: ".env.local" });

const DEFAULT_JA_VOICE = "ja-JP-NanamiNeural";
const DEFAULT_OUTPUT_DIR = path.resolve("tmp", "tts");
const DEFAULT_OUTPUT_FILE = "guide-output.wav";
const OUTPUT_FORMAT = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[Azure Speech] ${name} is not set. Add it to .env.local.`);
  }
  return value;
}

function validateGuideText(text) {
  const guideText = String(text ?? "").trim();
  if (!guideText) {
    throw new Error("[Azure Speech] speakGuide(text) requires a non-empty text string.");
  }
  return guideText;
}

function createSpeechConfig() {
  let key;
  let region;

  try {
    key = getRequiredEnv("AZURE_SPEECH_KEY");
  } catch {
    throw new Error(
      "[Azure Speech] Missing speech key. Set AZURE_SPEECH_KEY in .env.local."
    );
  }

  try {
    region = getRequiredEnv("AZURE_SPEECH_REGION");
  } catch {
    throw new Error(
      "[Azure Speech] Missing speech region. Set AZURE_SPEECH_REGION in .env.local."
    );
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisLanguage = "ja-JP";
  speechConfig.speechSynthesisVoiceName =
    process.env.AZURE_SPEECH_VOICE?.trim() || DEFAULT_JA_VOICE;
  speechConfig.speechSynthesisOutputFormat = OUTPUT_FORMAT;
  return speechConfig;
}

function synthesizeText(guideText) {
  const speechConfig = createSpeechConfig();
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

  return new Promise((resolve, reject) => {
    synthesizer.speakTextAsync(
      guideText,
      (result) => {
        try {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve({
              audioData: Buffer.from(result.audioData),
              voice: speechConfig.speechSynthesisVoiceName,
              format: "audio/wav",
            });
            return;
          }

          const details = sdk.CancellationDetails.fromResult(result);
          reject(
            new Error(
              `[Azure Speech] Speech synthesis failed: ${details.reason}${
                details.errorDetails ? ` | ${details.errorDetails}` : ""
              }`
            )
          );
        } finally {
          synthesizer.close();
        }
      },
      (error) => {
        synthesizer.close();
        reject(new Error(`[Azure Speech] SDK error: ${error}`));
      }
    );
  });
}

export async function synthesizeGuide(text) {
  const guideText = validateGuideText(text);
  return synthesizeText(guideText);
}

export async function speakGuide(text) {
  const guideText = validateGuideText(text);
  const { audioData, voice, format } = await synthesizeText(guideText);

  fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(DEFAULT_OUTPUT_DIR, DEFAULT_OUTPUT_FILE);
  fs.writeFileSync(outputPath, audioData);

  return {
    outputPath,
    voice,
    format,
  };
}
