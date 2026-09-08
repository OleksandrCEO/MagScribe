import { spawn } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';

export const SAMPLE_RATE = 16_000;

const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

// Packaged builds get the binary via packagerConfig.extraResource — the Vite plugin strips node_modules
// from the asar, so it cannot be required from there at runtime.
const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, binaryName)
  : path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', binaryName);

/**
 * Decodes the audio track of any media file ffmpeg can read into 16 kHz mono samples.
 *
 * ffmpeg writes raw `f32le` to stdout — the exact byte layout of a Float32Array, i.e. WAV without the
 * 44-byte header we would have to strip again anyway.
 */
export const extractAudio = (filePath: string): Promise<Float32Array> =>
  new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', filePath,
      '-vn', // video streams would only slow the decode down
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-f', 'f32le',
      'pipe:1',
    ]);

    // ponytail: the whole track is buffered in RAM (~230 MB per hour); stream it to disk if long files start to hurt
    const chunks: Buffer[] = [];
    let errorOutput = '';

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorOutput = (errorOutput + chunk.toString()).slice(-2000); // keep the tail, ffmpeg can be chatty
    });

    ffmpeg.on('error', reject); // binary missing or not executable
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed with code ${code}: ${errorOutput.trim() || 'no error output'}`));
        return;
      }

      const pcm = Buffer.concat(chunks);
      const samples = Math.floor(pcm.length / Float32Array.BYTES_PER_ELEMENT);
      if (samples === 0) {
        reject(new Error(`No audio track found in ${filePath}`));
        return;
      }

      // Buffer.concat may hand back a view into a larger pool, so respect byteOffset instead of assuming 0.
      resolve(new Float32Array(pcm.buffer, pcm.byteOffset, samples));
    });
  });
