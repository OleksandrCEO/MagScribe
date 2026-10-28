/**
 * Every line the app shows, in both languages it speaks. No framework: two objects and `en: typeof uk`, which
 * makes a forgotten key a type error instead of a Ukrainian word in an English window.
 *
 * Keep this module free of node and React imports — main, the worker and the renderer all read it.
 *
 * Markup inside a line: `*emphasis*` and `` `code` ``, the two things the dialogs need. `rich()` in settings.tsx
 * renders them, so a whole sentence stays one translatable string instead of three fragments in a fixed order.
 *
 * The prompts are not here on purpose: they are instructions for the model, in English for both languages, and
 * the answer follows the recording rather than the interface — see prompts.ts.
 */

export type UiLang = 'uk' | 'en';

export const UI_LANGS: readonly UiLang[] = ['uk', 'en'];

/** What the language picker in the settings window says — each in its own language, as every list of them does. */
export const LANG_NAMES: Record<UiLang, string> = { uk: 'Українська', en: 'English' };

/** A BCP 47 tag (`navigator.language`, `app.getLocale()`) → the closest language we have. */
export const pickUiLang = (tag: string): UiLang => (tag.toLowerCase().startsWith('uk') ? 'uk' : 'en');

/** 1 слово · 2 слова · 5 слів. Ukrainian needs all three, and the one-liner is cheaper than reading «1 слів». */
const plural = (n: number, one: string, few: string, many: string): string =>
  n % 10 === 1 && n % 100 !== 11
    ? one
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? few
      : many;

const uk = {
  locale: 'uk', // for toLocaleString: the decimal comma, and the group separators that come with it
  sizes: ['Б', 'КБ', 'МБ', 'ГБ'],
  words: (n: number): string => `${n} ${plural(n, 'слово', 'слова', 'слів')}`,
  cues: (n: number): string => `${n} ${plural(n, 'репліка', 'репліки', 'реплік')}`,
  chapters: (n: number): string => `${n} ${plural(n, 'розділ', 'розділи', 'розділів')}`,

  ui: {
    settings: 'Налаштування',
    about: 'Про MagScribe',
    startOver: 'Почати заново',
    close: 'Закрити',
    stop: 'Зупинити',
    retry: 'Спробувати ще раз',
    dropTitle: 'Перетягни відео або аудіо',
    dropHint: 'MP4, MKV, MOV, MP3, WAV та інші',
    dropPick: 'Вибрати файл',
    saveTrack: 'Зберегти аудіодоріжку .ogg',
    downloadModel: 'Завантажити модель',
    audioReady: 'Аудіодоріжку витягнуто. Збережи її або запусти транскрибацію.',
    transcribedIn: (time: string, words: string): string => ` · розшифровано за ${time} · ${words}`,
  },

  theme: { light: 'Світла', system: 'Як у системі', dark: 'Темна' },

  /** The language of the recording, not of the interface: three bare words with a tooltip each. */
  speech: {
    auto: 'Авто',
    autoHint: 'Мова розпізнавання — визначити автоматично',
    ukHint: 'Мова розпізнавання — українська',
    enHint: 'Мова розпізнавання — англійська',
  },

  screen: {
    transcript: 'Текст',
    subtitles: 'Субтитри',
    summary: 'Конспект',
    chapters: 'Таймкоди',
    audio: 'Аудіо',
    conversion: 'Конвертація',
    transcription: 'Транскрибація',
  },

  job: {
    audioFile: 'Готую аудіофайл',
    readingAudio: 'Читаю звук із файлу',
    merging: 'Збираю текст і таймкоди',
    transcribing: 'Транскрибація',
    summary: 'Готую конспект',
    chapters: 'Готую таймкоди',
    downloading: 'Завантаження моделі',
    preparing: 'Готую модель до роботи — перший запуск триває кілька хвилин',
  },

  status: {
    awake: 'Машина не засне до завершення',
    done: 'Готово',
    modelReady: 'Модель готова',
    api: 'Розшифровка через API',
    preparing: 'Готую модель',
    downloading: 'Завантажую модель',
    modelAbsent: 'Модель не завантажена',
  },

  toast: {
    copied: 'Скопійовано',
    clipboardRefused: 'Буфер обміну не прийняв текст',
    saved: 'Збережено',
    stopped: 'Зупинено',
    stoppedAt: (time: string): string => `Зупинено на ${time} — можна продовжити`,
    transcribed: (words: string): string => `Транскрибація завершена — ${words}`,
    modelDeleted: 'Модель видалено — наступного разу застосунок спитає знову',
  },

  pill: {
    copy: 'Копіювати',
    saveTxt: 'Зберегти .txt',
    saveSrt: 'Зберегти .srt',
    saveOgg: 'Зберегти .ogg',
    resumeFrom: (time: string): string => `Продовжити з ${time}`,
    toText: 'До тексту',
    text: 'Текст',
    toSubtitles: 'До субтитрів',
    subtitles: 'Субтитри',
    toTranscript: 'До транскрипту',
    transcribe: 'Транскрибувати',
    transcribing: 'Транскрибую…',
    waitingForModel: 'Чекаю на модель…',
    convert: 'Конвертувати у звук',
    convertShort: 'Конвертувати',
    summary: 'Конспект',
    process: 'Опрацювати',
    processing: 'Готую конспект…',
    chapters: 'Таймкоди',
    chaptering: 'Готую таймкоди…',
  },

  /** What a saved file is called; the base name is the recording's own. */
  file: {
    chapters: (base: string): string => `${base} — таймкоди.txt`,
    summary: (base: string): string => `${base} — конспект.txt`,
  },

  stopDialog: {
    title: 'Зупинити транскрибацію?',
    cancel: 'Хай працює',
    confirm: 'Зупинити',
    body: [
      'Розшифроване лишиться, і прогін можна буде продовжити з місця зупинки.',
      'Але субтитри *.srt* для цього файлу вже не вийдуть: таймкоди складаються в одне ціле лише наприкінці ' +
        'повного прогону.',
    ],
  },

  closeDialog: {
    title: 'Закрити застосунок?',
    cancel: 'Хай працює',
    confirm: 'Закрити',
    body: [
      'Робота ще триває.',
      'Якщо закрити зараз, усе розшифроване *зникне без сліду* — на відміну від зупинки, тут нічого не ' +
        'лишається на екрані.',
    ],
  },

  // The first time the model would be asked about: both engines and the key on one screen, the rest in settings.
  setup: {
    model: (size: string): string => `Модель · ${size}`,
    keyLater: 'можна пізніше — у налаштуваннях',
    done: 'Готово',
  },

  // The one thing the app downloads by itself, so it is asked for out loud — and only when the weights are not
  // in the cache already, because loading a cached model downloads nothing.
  modelDialog: {
    title: 'Завантажити модель?',
    cancel: 'Не зараз',
    confirm: (size: string): string => `Завантажити ${size}`,
    body: (name: string, gpu: boolean): string[] => [
      'Для розшифровки потрібна модель. Вона завантажується один раз із huggingface.co і лишається в кеші ' +
        'застосунку — змінити чи видалити її можна в налаштуваннях.',
      gpu
        ? `Рекомендована *${name}*: тут є відеокарта, яка її потягне.`
        : `Рекомендована *${name}* — так, на процесорі вона повільна. Менша модель швидша, але помітно ` +
          'гірше розпізнає українську й технічні слова, і виправити це у вікні вже не вийде.',
    ],
  },

  /** The models themselves: what each is for, and what the row says about it. */
  model: {
    small: 'швидша, помітно гірша — особливо українською',
    turbo: 'найточніша; без відеокарти повільна',
    recommended: 'рекомендована',
    downloaded: 'завантажена',
    stale: 'залишки на диску',
  },

  ffmpegDialog: {
    title: 'Потрібен ffmpeg',
    cancel: 'Зрозуміло',
    confirm: 'Відкрити сайт ffmpeg',
    cannotRead: 'Цей файл не вдалося прочитати — для нього потрібен ffmpeg.',
    forTrack: 'Щоб зберегти аудіодоріжку окремим файлом, потрібен ffmpeg.',
    body: (reason: string): string[] => [
      `${reason} Утиліта *ffmpeg* у системі не знайшлася.`,
      'Коротке відео чи аудіо MagScribe розшифрує й без неї — прочитає сам, декодером браузера. Але довгі ' +
        'файли, контейнери AVI та WMV і збереження аудіодоріжки без ffmpeg не вийдуть.',
      'У Linux вона майже завжди є в пакетах дистрибутива (`ffmpeg`); для Windows і macOS збірки лежать на ' +
        'сайті проєкту.',
    ],
  },

  settings: {
    language: 'Мова інтерфейсу',
    model: 'Модель розпізнавання',
    deleteModel: 'Видалити',
    promptsHint:
      'Інструкції, які отримує модель. Можна замінити на власні, або підкоригувати за бажанням. Порожнє поле ' +
      'підставить промпт за замовчуванням.',
    reset: 'Скинути',
    speechEngine: 'Розшифровка',
    speechEngines: { whisper: 'Модель розпізнавання', api: 'API' },
    aiEngine: 'Конспект і таймкоди',
    engines: { claude: 'claude', codex: 'codex', api: 'API', off: 'Вимкнено' },
    custom: 'Локально',
    speechHint:
      'Deepgram — або «Локально»: будь-який OpenAI-сумісний `/audio/transcriptions` з таймкодами (`verbose_json`, як '
      + 'у `whisper-1`). Адреса — до `/v1` включно.',
    summaryHint: 'Будь-який OpenAI-сумісний `/chat/completions`. Модель — зі списку або будь-яка інша вручну.',
    // How the model suggestions are labelled; see providers.ts.
    tier: { cheap: 'дешевша', light: 'легша', smart: 'розумніша' },
    baseUrl: 'Адреса',
    speechModel: 'Модель розшифровки',
    apiModel: 'Модель конспекту',
    apiKey: 'Ключ',
    keySaved: 'збережено; новий замінить його',
    keyNone: 'не потрібен для власного сервера',
    forgetKey: 'Забути ключ',
    save: 'Зберегти',
    check: 'Перевірити',
    checking: 'Перевіряю…',
    checkOk: 'відповідає',
    // Keyed by task, so prompts.ts holds only the storage keys and the settings window needs no mapping.
    prompt: { summary: 'Конспект — кнопка «Опрацювати»', chapters: 'Таймкоди — для формування розділів' },
  },

  /** `version` is the build, `model` the one in use, `engine` the adapter line (null while it is loading). */
  about: (version: string, model: string, engine: string | null): string[] => [
    `*MagScribe ${version}* — транскрибація відео й аудіо: текст, субтитри .srt і таймкоди розділів.`,
    `Модель розпізнавання: ${model}${engine ? ` *(${engine})*` : ''}.`,
    'Моделі — *openai/whisper* (MIT) у ONNX-конверсії onnx-community: large-v3-turbo для відеокарти і small ' +
      'для процесора; звук читає системний `ffmpeg`. Умови сторонніх компонентів — у файлі ' +
      '*THIRD-PARTY-LICENSES.md* поруч із застосунком. Сам MagScribe — під MIT.',
  ],

  /** Names in the system's own open dialog. */
  filter: { video: 'Відео', audio: 'Аудіо', all: 'Усі файли' },

  error: {
    ffmpegMissing: 'Не знайдено ffmpeg. Встанови його — без нього не вийде ні прочитати звук, ні зберегти аудіо.',
    ffmpegBusy: 'Конвертація вже триває',
    noAudioTrack: 'У файлі немає звукової доріжки',
    tooLongForMemory: (need: string, free: string) =>
      `Запис задовгий для вільної памʼяті: розшифровка потребує ~${need} ГБ, а вільно ~${free} ГБ. `
      + 'Розріжте файл на частини й розшифруйте кожну окремо — або звільніть памʼять і спробуйте ще раз.',
    cliMissing: {
      claude: 'Команду claude не знайдено. Встанови Claude Code CLI і перевір, що вона є у PATH.',
      codex: 'Команду codex не знайдено. Встанови Codex CLI і перевір, що вона є у PATH.',
    },
    replyTooBig: 'Відповідь не вмістилася у 8 МБ',
    cliTimeout: (cli: string, seconds: number): string => `${cli} не вклався у ${seconds} секунд`,
    summaryOff: 'Конспект вимкнено в налаштуваннях.',
    apiBadUrl: 'Адреса API має починатися з https:// (http:// — лише для localhost) і бути без логіна та параметрів.',
    apiIncomplete: 'Для API потрібні адреса й модель.',
    apiKeyMalformed: 'У ключі не може бути пробілів чи переносів рядка.',
    noKeyring:
      'Немає системного сховища ключів (KWallet чи GNOME Keyring), тож ключ не збережено: без нього він лежав би '
      + 'на диску відкритим текстом.',
    keyUnreadable: 'Збережений ключ не вдалося розшифрувати. Введи його ще раз у налаштуваннях.',
    apiUnreachable: (host: string, reason: string): string => `Не вдалося зʼєднатися з ${host}: ${reason}`,
    apiKeyRejected: (detail: string): string => `Сервер не прийняв ключ: ${detail}`,
    apiFailed: (status: number, detail: string): string => `Сервер відповів ${status}: ${detail}`,
    apiEmpty: 'Сервер відповів без тексту',
    apiTimeout: (seconds: number): string => `Сервер не відповів за ${seconds} секунд`,
    noTimestamps: (model: string): string =>
      `Модель ${model} повернула текст без таймкодів, а без них не буде ні субтитрів, ні розділів. Обери модель, `
      + 'що вміє verbose_json (наприклад, whisper-1), або Deepgram.',
    adapterNull: 'requestAdapter() повернув null',
    unknownAdapter: 'невідомий адаптер',
    softwareAdapter: (label: string): string => `програмний адаптер «${label}» замість відеокарти`,
    modelNotLoaded: 'Модель ще не завантажена',
    workerFailed: 'Воркер не запустився',
    gpuGone: (reason: string, code: number): string => `GPU-процес завершився (${reason}, код ${code})`,
    restartApp: (message: string): string => `${message}. Перезапусти застосунок.`,
    fallback: (from: string, reason: string): string => `${from} недоступний: ${reason}`,
  },

  // The command line (see cli.ts). Progress and errors go to stderr; stdout carries nothing but the result.
  cli: {
    notAFile: (file: string): string => `Не файл: ${file}`,
    busy: 'MagScribe уже запущений. Закрий його вікно й повтори команду.',
    guiBlocked: 'MagScribe зараз розшифровує файл із командного рядка. Відкрий вікно, коли він закінчить.',
    noModel: (name: string): string =>
      `Модель ${name} ще не завантажена. Відкрий MagScribe і завантаж її у вікні — командний рядок `
      + 'сам нічого не качає.',
    engine: (adapter: string): string => `Рушій: ${adapter}`,
    reading: (percent: number): string => `Читаю звук: ${percent}%`,
    transcribing: (percent: number): string => `Розшифровую: ${percent}%`,
    merging: 'Зшиваю фрагменти…',
  },
};

const en: typeof uk = {
  locale: 'en',
  sizes: ['B', 'KB', 'MB', 'GB'],
  words: (n: number): string => `${n} word${n === 1 ? '' : 's'}`,
  cues: (n: number): string => `${n} cue${n === 1 ? '' : 's'}`,
  chapters: (n: number): string => `${n} chapter${n === 1 ? '' : 's'}`,

  ui: {
    settings: 'Settings',
    about: 'About MagScribe',
    startOver: 'Start over',
    close: 'Close',
    stop: 'Stop',
    retry: 'Try again',
    dropTitle: 'Drop a video or an audio file',
    dropHint: 'MP4, MKV, MOV, MP3, WAV and others',
    dropPick: 'Choose a file',
    saveTrack: 'Save the audio track as .ogg',
    downloadModel: 'Download the model',
    audioReady: 'The audio track is out. Save it, or start the transcription.',
    transcribedIn: (time: string, words: string): string => ` · transcribed in ${time} · ${words}`,
  },

  theme: { light: 'Light', system: 'Follow the system', dark: 'Dark' },

  speech: {
    auto: 'Auto',
    autoHint: 'Speech language — detect it automatically',
    ukHint: 'Speech language — Ukrainian',
    enHint: 'Speech language — English',
  },

  screen: {
    transcript: 'Text',
    subtitles: 'Subtitles',
    summary: 'Summary',
    chapters: 'Chapters',
    audio: 'Audio',
    conversion: 'Conversion',
    transcription: 'Transcription',
  },

  job: {
    audioFile: 'Preparing the audio file',
    readingAudio: 'Reading the sound out of the file',
    merging: 'Putting the text and the timecodes together',
    transcribing: 'Transcription',
    summary: 'Writing the summary',
    chapters: 'Writing the chapters',
    downloading: 'Downloading the model',
    preparing: 'Getting the model ready — the first run takes a few minutes',
  },

  status: {
    awake: 'The machine stays awake until this is done',
    done: 'Done',
    modelReady: 'The model is ready',
    api: 'Transcription over the API',
    preparing: 'Getting the model ready',
    downloading: 'Downloading the model',
    modelAbsent: 'The model is not downloaded',
  },

  toast: {
    copied: 'Copied',
    clipboardRefused: 'The clipboard refused the text',
    saved: 'Saved',
    stopped: 'Stopped',
    stoppedAt: (time: string): string => `Stopped at ${time} — you can carry on from there`,
    transcribed: (words: string): string => `Transcription finished — ${words}`,
    modelDeleted: 'The model is deleted — the app will ask again next time',
  },

  pill: {
    copy: 'Copy',
    saveTxt: 'Save .txt',
    saveSrt: 'Save .srt',
    saveOgg: 'Save .ogg',
    resumeFrom: (time: string): string => `Carry on from ${time}`,
    toText: 'To the text',
    text: 'Text',
    toSubtitles: 'To the subtitles',
    subtitles: 'Subtitles',
    toTranscript: 'To the transcript',
    transcribe: 'Transcribe',
    transcribing: 'Transcribing…',
    waitingForModel: 'Waiting for the model…',
    convert: 'Convert to sound',
    convertShort: 'Convert',
    summary: 'Summary',
    process: 'Process',
    processing: 'Writing the summary…',
    chapters: 'Chapters',
    chaptering: 'Writing the chapters…',
  },

  file: {
    chapters: (base: string): string => `${base} — chapters.txt`,
    summary: (base: string): string => `${base} — summary.txt`,
  },

  stopDialog: {
    title: 'Stop the transcription?',
    cancel: 'Let it run',
    confirm: 'Stop',
    body: [
      'Everything transcribed so far stays, and the run can carry on from where it stopped.',
      'But *.srt* subtitles for this file are off the table: the timecodes are only put together at the very ' +
        'end of a full run.',
    ],
  },

  closeDialog: {
    title: 'Close the app?',
    cancel: 'Let it run',
    confirm: 'Close',
    body: [
      'Work is still in progress.',
      'Closing now makes everything transcribed *disappear without a trace* — unlike stopping, which leaves ' +
        'it on screen.',
    ],
  },

  setup: {
    model: (size: string): string => `Model · ${size}`,
    keyLater: 'can wait — it is in the settings',
    done: 'Done',
  },

  modelDialog: {
    title: 'Download the model?',
    cancel: 'Not now',
    confirm: (size: string): string => `Download ${size}`,
    body: (name: string, gpu: boolean): string[] => [
      'Transcription needs a model. It is downloaded once from huggingface.co and stays in the app cache — ' +
        'the settings window changes it or deletes it again.',
      gpu
        ? `The recommended one is *${name}*: there is a graphics card here to carry it.`
        : `The recommended one is *${name}* — slow on a processor, yes. The smaller model is faster, but it ` +
          'mishears Ukrainian and technical words badly enough that the text cannot be repaired afterwards.',
    ],
  },

  model: {
    small: 'faster, noticeably worse — especially in Ukrainian',
    turbo: 'most accurate; slow without a graphics card',
    recommended: 'recommended',
    downloaded: 'downloaded',
    stale: 'leftovers on disk',
  },

  ffmpegDialog: {
    title: 'ffmpeg is needed',
    cancel: 'Understood',
    confirm: 'Open the ffmpeg site',
    cannotRead: 'This file could not be read — it needs ffmpeg.',
    forTrack: 'Saving the audio track as a separate file needs ffmpeg.',
    body: (reason: string): string[] => [
      `${reason} The *ffmpeg* tool was not found on this machine.`,
      'A short video or audio file MagScribe transcribes without it — the browser decoder reads those. Long ' +
        'files, AVI and WMV containers and saving the audio track all need ffmpeg.',
      'On Linux it is almost always in the distribution packages (`ffmpeg`); for Windows and macOS the builds ' +
        'are on the project site.',
    ],
  },

  settings: {
    language: 'Interface language',
    model: 'Speech model',
    deleteModel: 'Delete',
    promptsHint:
      'The instructions the model gets. Replace them with your own, or tweak them as you like. An empty field ' +
      'falls back to the built-in prompt.',
    reset: 'Reset',
    speechEngine: 'Transcription',
    speechEngines: { whisper: 'Speech model', api: 'API' },
    aiEngine: 'Summary and chapters',
    engines: { claude: 'claude', codex: 'codex', api: 'API', off: 'Off' },
    custom: 'Local',
    speechHint:
      'Deepgram — or “Local”: any OpenAI-compatible `/audio/transcriptions` with timestamps (`verbose_json`, like '
      + '`whisper-1`). The address goes up to `/v1`.',
    summaryHint: 'Any OpenAI-compatible `/chat/completions`. A model from the list, or any other typed by hand.',
    tier: { cheap: 'cheaper', light: 'lighter', smart: 'smarter' },
    baseUrl: 'Address',
    speechModel: 'Transcription model',
    apiModel: 'Summary model',
    apiKey: 'Key',
    keySaved: 'saved; a new one replaces it',
    keyNone: 'not needed for your own server',
    forgetKey: 'Forget the key',
    save: 'Save',
    check: 'Check',
    checking: 'Checking…',
    checkOk: 'answers',
    prompt: { summary: 'Summary — the “Process” button', chapters: 'Chapters — for building the sections' },
  },

  about: (version: string, model: string, engine: string | null): string[] => [
    `*MagScribe ${version}* — transcription of video and audio: text, .srt subtitles and chapter timecodes.`,
    `Speech model: ${model}${engine ? ` *(${engine})*` : ''}.`,
    'The models are *openai/whisper* (MIT) in the ONNX conversion by onnx-community: large-v3-turbo for the ' +
      'graphics card and small for the processor; the sound is read by the system `ffmpeg`. The terms of the ' +
      'third-party components are in *THIRD-PARTY-LICENSES.md* next to the app. MagScribe itself is under MIT.',
  ],

  filter: { video: 'Video', audio: 'Audio', all: 'All files' },

  error: {
    ffmpegMissing: 'ffmpeg was not found. Install it — without it the sound cannot be read, nor the audio saved.',
    ffmpegBusy: 'A conversion is already running',
    noAudioTrack: 'The file has no audio track',
    tooLongForMemory: (need: string, free: string) =>
      `The recording is too long for the free memory: transcribing it needs ~${need} GB and ~${free} GB is `
      + 'free. Split the file and transcribe the parts, or free some memory and try again.',
    cliMissing: {
      claude: 'The claude command was not found. Install the Claude Code CLI and check that it is on PATH.',
      codex: 'The codex command was not found. Install the Codex CLI and check that it is on PATH.',
    },
    replyTooBig: 'The answer did not fit into 8 MB',
    cliTimeout: (cli: string, seconds: number): string => `${cli} did not finish within ${seconds} seconds`,
    summaryOff: 'The summary is switched off in the settings.',
    apiBadUrl: 'The API address must start with https:// (http:// only for localhost), with no login or parameters.',
    apiIncomplete: 'The API needs an address and a model.',
    apiKeyMalformed: 'A key cannot contain spaces or line breaks.',
    noKeyring:
      'There is no system keyring (KWallet or GNOME Keyring), so the key was not saved: without one it would sit '
      + 'on disk in plain text.',
    keyUnreadable: 'The saved key could not be decrypted. Enter it again in the settings.',
    apiUnreachable: (host: string, reason: string): string => `Could not connect to ${host}: ${reason}`,
    apiKeyRejected: (detail: string): string => `The server did not accept the key: ${detail}`,
    apiFailed: (status: number, detail: string): string => `The server answered ${status}: ${detail}`,
    apiEmpty: 'The server answered with no text',
    apiTimeout: (seconds: number): string => `The server did not answer within ${seconds} seconds`,
    noTimestamps: (model: string): string =>
      `The model ${model} returned text without timestamps, and without them there are no subtitles and no `
      + 'chapters. Pick a model that does verbose_json (such as whisper-1), or Deepgram.',
    adapterNull: 'requestAdapter() returned null',
    unknownAdapter: 'unknown adapter',
    softwareAdapter: (label: string): string => `software adapter “${label}” instead of a graphics card`,
    modelNotLoaded: 'The model is not loaded yet',
    workerFailed: 'The worker did not start',
    gpuGone: (reason: string, code: number): string => `The GPU process exited (${reason}, code ${code})`,
    restartApp: (message: string): string => `${message}. Restart the app.`,
    fallback: (from: string, reason: string): string => `${from} is unavailable: ${reason}`,
  },

  cli: {
    notAFile: (file: string): string => `Not a file: ${file}`,
    busy: 'MagScribe is already running. Close its window and run the command again.',
    guiBlocked: 'MagScribe is transcribing a file from the command line. Open the window once it is done.',
    noModel: (name: string): string =>
      `The ${name} model is not downloaded yet. Open MagScribe and download it there — the command line `
      + 'downloads nothing.',
    engine: (adapter: string): string => `Engine: ${adapter}`,
    reading: (percent: number): string => `Reading audio: ${percent}%`,
    transcribing: (percent: number): string => `Transcribing: ${percent}%`,
    merging: 'Stitching the chunks…',
  },
};

export type Strings = typeof uk;

export const STRINGS: Record<UiLang, Strings> = { uk, en };

// Main and the worker have no React to re-render, so they read the language off the module: main is told by the
// window over `lang:set`, the worker gets it with its `load` message. The renderer reads STRINGS directly.
let current: UiLang = 'uk';

export const setUiLang = (lang: UiLang): void => {
  current = lang;
};

export const t = (): Strings => STRINGS[current];

/** `1,4 ГБ` / `1.4 GB`. A decimal only where it says something: past 100 of anything it is noise. */
export const formatSize = (bytes: number, s: Strings): string => {
  const power = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), s.sizes.length - 1) : 0;
  const value = bytes / 1024 ** power;
  const digits = power === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString(s.locale, { maximumFractionDigits: digits })} ${s.sizes[power]}`;
};
