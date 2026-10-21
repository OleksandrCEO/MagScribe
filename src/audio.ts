import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { ExportedAudio } from './preload';
import { SAMPLE_RATE } from './pcm';

const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

/**
 * The system's ffmpeg, looked up on PATH once at startup.
 *
 * We deliberately do not ship a binary: the prebuilt static builds are GPLv3 (their x264/x265 encoders force
 * it), and conveying one would oblige us to publish matching sources for ffmpeg and every library linked into
 * it — for capability this app never uses. It only decodes to raw PCM and encodes Opus. The distro's own copy
 * is the user's own copy, so nothing is conveyed and nothing is owed.
 */
const findFfmpeg = (): string | null => {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue;
    const candidate = path.join(dir, binaryName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here, keep looking
    }
  }
  return null;
};

let ffmpegPath: string | null | undefined; // undefined: PATH not searched yet

/** Absolute path to ffmpeg, or null when the system has none. Re-checked after a failed lookup, so the user
 *  can install ffmpeg and carry on without restarting the app. */
export const ffmpegBinary = (): string | null => {
  if (ffmpegPath === undefined || ffmpegPath === null) ffmpegPath = findFfmpeg();
  return ffmpegPath;
};

export const FFMPEG_MISSING = 'Не знайдено ffmpeg. Встанови його — без нього не вийде ні прочитати звук, ні зберегти аудіо.';

export type OnProgress = (percent: number) => void;

const parseClock = (clock: string): number => {
  const [hours, minutes, seconds] = clock.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
};

/**
 * Runs ffmpeg to completion; stdout goes to `onData`, a non-zero exit becomes an error carrying stderr's tail.
 *
 * Progress rides on stderr: the input banner carries `Duration:` and `-progress pipe:2` adds `out_time_us=` lines
 * every half second, which together make a percentage. `-nostats` keeps the human-readable ticker out of it.
 */
// The window never starts two conversions at once, so one handle is all it takes to stop the current run.
let running: ReturnType<typeof spawn> | null = null;

/** Kills the ffmpeg behind an extract or an export; the pending promise then rejects on its own. */
export const cancelFfmpeg = (): void => {
  running?.kill('SIGKILL');
};

const runFfmpeg = (
  args: string[],
  onProgress?: OnProgress,
  onData?: (chunk: Buffer) => void,
  skip = 0, // seconds seeked past before decoding, so the percentage counts what is left and not the whole file
): Promise<void> =>
  new Promise((resolve, reject) => {
    const binary = ffmpegBinary();
    if (binary === null) {
      reject(new Error(FFMPEG_MISSING));
      return;
    }
    // One conversion at a time: `running` is a single handle, and a second run would leave the first one
    // unkillable. The window already prevents this; main does not take the window's word for it.
    if (running !== null) {
      reject(new Error('Конвертація вже триває'));
      return;
    }

    const ffmpeg = spawn(binary, ['-hide_banner', '-loglevel', 'info', '-nostats', '-progress', 'pipe:2', ...args]);
    running = ffmpeg;
    let errorOutput = '';
    let pendingLine = '';
    let duration = 0;

    ffmpeg.stdout.on('data', (chunk: Buffer) => onData?.(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      const lines = (pendingLine + chunk.toString()).split('\n');
      pendingLine = lines.pop() ?? '';
      for (const line of lines) {
        const clock = /^\s*Duration: (\d+:\d\d:\d\d\.\d+)/.exec(line);
        const time = /^out_time_us=(\d+)/.exec(line);
        if (clock) duration = parseClock(clock[1]);
        else if (time) {
          const span = duration - skip;
          onProgress?.(span > 0 ? Math.min(100, Number(time[1]) / 1e6 / span * 100) : 0);
        }
        else if (!/^\w+=/.test(line)) errorOutput = `${errorOutput}${line}\n`.slice(-2000); // keep the tail
      }
    });

    ffmpeg.on('error', (error) => {
      running = null; // a failed spawn must not leave the slot occupied forever
      reject(error); // binary missing or not executable
    });
    ffmpeg.on('close', (code) => {
      running = null;
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed with code ${code}: ${errorOutput.trim() || 'no error output'}`));
    });
  });

/**
 * Decodes the audio track of any media file ffmpeg can read into 16 kHz mono samples.
 *
 * ffmpeg writes raw `f32le` to stdout — the exact byte layout of a Float32Array, i.e. WAV without the
 * 44-byte header we would have to strip again anyway.
 */
export const extractAudio = async (filePath: string, onProgress?: OnProgress, from = 0): Promise<Float32Array> => {
  // ponytail: the whole track is buffered in RAM (~230 MB per hour); stream it to disk if long files start to hurt
  const chunks: Buffer[] = [];
  // -vn: video streams would only slow the decode down. -ss ahead of -i seeks on the input, which is the fast one,
  // and is how a resumed run decodes only the part it still needs.
  // -protocol_whitelist file: a hostile playlist (.m3u8, concat) could otherwise make ffmpeg read other local
  // files or go out to the network, and their audio would land in the transcript.
  await runFfmpeg(
    ['-protocol_whitelist', 'file', ...(from > 0 ? ['-ss', String(from)] : []), '-i', filePath, '-vn', '-ac', '1',
      '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
    onProgress,
    (chunk) => chunks.push(chunk),
    from,
  );

  const pcm = Buffer.concat(chunks);
  const samples = Math.floor(pcm.length / Float32Array.BYTES_PER_ELEMENT);
  if (samples === 0) throw new Error(`No audio track found in ${filePath}`);

  // Buffer.concat may hand back a view into a larger pool, so respect byteOffset instead of assuming 0.
  return new Float32Array(pcm.buffer, pcm.byteOffset, samples);
};

// Only one exported track lives at a time: a new export or quitting removes the previous one from temp.
let lastExport: string | null = null;

export const discardExport = (): void => {
  if (lastExport === null) return;
  try {
    // The whole private directory, not just the file: mkdtemp made it for this one export.
    fs.rmSync(path.dirname(lastExport), { recursive: true, force: true });
  } catch {
    // runs from will-quit; a temp file we cannot delete is not worth blocking the exit
  }
  lastExport = null;
};

/** The file `exportAudio` produced last — the only source `audio:save` agrees to copy out. */
export const isExport = (filePath: string): boolean => filePath === lastExport;

/** Re-encodes the audio track to OGG/Opus in the temp folder — the container Telegram plays as a voice message. */
export const exportAudio = async (filePath: string, onProgress?: OnProgress): Promise<ExportedAudio> => {
  discardExport();
  // A private directory (0700) rather than a predictable name in a world-readable /tmp: the recording is the
  // user's, and `-y` would happily follow a symlink someone else put there first.
  const target = path.join(fs.mkdtempSync(path.join(app.getPath('temp'), 'magscribe-')), 'export.ogg');
  // ponytail: 64 kbps is plenty for speech and passable for music; raise it if the export is meant for listening
  await runFfmpeg(
    ['-protocol_whitelist', 'file', '-y', '-i', filePath, '-vn', '-c:a', 'libopus', '-b:a', '64k', target],
    onProgress,
  );
  lastExport = target;

  const { size } = await fs.promises.stat(target);
  return { path: target, size };
};
