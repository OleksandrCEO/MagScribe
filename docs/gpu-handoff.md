# WebGPU на NixOS: чому карта не працює і що вже перевірено

Документ для нового чату. Мета: **транскрибація має рахуватися на відеокарті** (NVIDIA, драйвер 595.71.05,
NixOS, KDE Wayland). Зараз вона рахується процесором, хоч підпис і писав «WebGPU». Усе нижче перевірено
8 вересня 2026 на цій машині; команди можна повторювати.

## Симптом

- Транскрибація стоїть на 0 % десять і більше хвилин, потім іде в рази повільніше за реальний час.
- GPU-процес Electron тримає 500–650 % CPU і 2,5–3 ГБ **системної** памʼяті.
- `nvidia-smi` показує наш GPU-процес як тип `G` (лише графіка) з **3 MiB** відеопамʼяті. Для порівняння
  Obsidian (Electron з nixpkgs) сидить там як `C+G` зі 192 MiB, OBS як `C+G` з 581 MiB.
- Підпис у вікні досі казав «WebGPU · q4», бо `requestAdapter()` повертав адаптер. Це був SwiftShader.

## Що доведено

1. **Адаптер програмний.** Він не має `shader-f16` (NVIDIA має; SwiftShader ні), не тримає відеопамʼяті, а
   всі обчислення йдуть у GPU-процесі на CPU. `libvk_swiftshader.so` лежить у `node_modules/electron/dist/`.
2. **Завантажувача Vulkan не було.** `libvulkan.so.1` не лежить у `/run/opengl-driver/lib` (там лише ICD
   окремих вендорів) і не був у `NIX_LD_LIBRARY_PATH`. Виправлено: `vulkan-loader` додано у `flake.nix`.
   Після `direnv reload` шлях зʼявляється:
   `echo $NIX_LD_LIBRARY_PATH | tr ':' '\n' | grep vulkan` → `…/vulkan-loader-1.4.357.0/lib`.
   Це було необхідно, але недостатньо.
3. **ICD NVIDIA існує і валідний.** `/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json` вказує на
   `/nix/store/…-nvidia-x11-595.71.05/lib/libGLX_nvidia.so.0`, файл на місці, версія збігається з драйвером.
4. **GPU-процес не може відкрити цей файл.** Із `VK_ICD_FILENAMES=/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json`
   Dawn пише:
   ```
   Warning: loader_get_json: Failed to open JSON file /run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json
   Warning: vkCreateInstance: Found no drivers!
   Warning: vkCreateInstance failed with VK_ERROR_INCOMPATIBLE_DRIVER
       at CheckVkSuccessImpl (../../third_party/dawn/src/dawn/native/vulkan/VulkanError.cpp:106)
   ```
   Файл читається з того самого користувача поза Electron. Отже, його блокує **пісочниця GPU-процесу
   Chromium**. Electron із nixpkgs пропатчений так, щоб пускати до `/run/opengl-driver`; Electron з npm ні.
   Це і є поточна робоча гіпотеза, і вона пояснює всі спостереження.

## Що виключено (не повторювати)

- **Композитор.** `--ozone-platform=x11` дає той самий `-9`, а вікно під XWayland стає крихітним. Рядок
  «'--ozone-platform=wayland' is not compatible with Vulkan» стосується Vulkan-композитора Chromium, який ми
  й так вимикаємо через `disable-gpu-compositing`; на Dawn він не впливає.
- **Кеш шейдерів.** Ліміт 6 MB на `DawnWebGPUCache` реальний і піднятий (`gpu-disk-cache-size-kb` у
  `main.ts`), але він допоможе лише коли адаптер стане справжнім.
- **Watchdog / OOM / падіння драйвера.** Памʼяті 46 GB, VRAM 16 GB; GPU-процес не падав, поки його не
  вбивали перезапуски. Обробник `child-process-gone` у `main.ts` тепер логує це в `userData/gpu.log`.
- **Перезапуски від правок.** Кожна правка в `src/` під час прогону перезапускала Electron або рендерер і
  зривала прогін. Правило: під час прогону `src/` не чіпати. `.direnv` виключено зі спостерігача Vite.

## Кандидати на рішення, за пріоритетом

### A. Electron із nixpkgs замість npm-бінарника (найімовірніше правильне для NixOS)

nixpkgs збирає Electron із патчами під `/run/opengl-driver`, і саме тому Obsidian бачить карту. Пакет
`electron` з npm поважає змінну `ELECTRON_OVERRIDE_DIST_PATH`: якщо вона вказує на теку з бінарником, Forge
запустить його замість скачаного. Перевірити:

1. Яка версія в nixpkgs-unstable: `nix eval nixpkgs#electron.version` (npm-пакет зараз 44.2.0; потрібна та
   сама мажорна версія, інакше preload/IPC можуть розійтися).
2. У `flake.nix` додати `pkgs.electron_44` (або як він там називається) і виставити
   `ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron_44}/libexec/electron";` у devShell.
3. `direnv reload && npm start`, потім перевірка з розділу нижче.

Ризик: інша мінорна версія Chromium, ніж у npm. Для dev це прийнятно. Для пакета `npm run make` це не
потрібно: на Ubuntu/Windows `/usr/share/vulkan/icd.d` існує, і пісочниця туди пускає. Це варто окремо
перевірити на іншій машині, бо зараз це припущення.

### B. Підкласти ICD туди, куди пісочниця пускає

Пісочниця GPU-процесу Chromium дозволяє читати `/usr/share/vulkan/icd.d` і `/etc/vulkan/icd.d`. На NixOS
`/etc` керований: `environment.etc."vulkan/icd.d/nvidia_icd.json".source = …nvidia_icd.json` у
`configuration.nix`. Але ICD вказує на бібліотеку в `/nix/store`, і її ще треба відкрити зсередини пісочниці.
Chromium підвантажує бібліотеки NVIDIA до входу в пісочницю для GL (`gpu_sandbox_hook_linux.cc`); чи робить
він те саме для Vulkan ICD, треба дивитися в джерелі. Якщо ні, варіант B не спрацює сам по собі.

### C. Лише для діагностики: `--disable-gpu-sandbox`

Один запуск із цим прапорцем підтвердить або спростує гіпотезу про пісочницю за хвилину: якщо карта зʼявиться,
причина знайдена точно. **Це послаблення безпеки, і в реліз воно не йде.** Рішення про такий запуск
приймаємо разом, не мовчки. Якщо навіть без пісочниці карти нема, гіпотеза хибна, і треба шукати далі
(наприклад, дивитись `--enable-logging=stderr --v=1` навколо `vulkan`).

## Як перевіряти результат

Підпису у вікні не вірити: він тепер показує назву адаптера з `adapter.info`, і це вже краще, але остаточний
суддя один:

```bash
for p in $(pgrep -f 'dist/electron --type=gpu-process'); do nvidia-smi | grep " $p "; done
```

Потрібно: тип `C+G` і сотні MiB. Зараз: `G` і 3 MiB.

Другий знак: у логу `npm start` зникає `vkCreateInstance() failed: -9` / `Found no drivers!`.

Третій: у підписі внизу вікна зʼявляється `WebGPU · nvidia …`, а не `CPU · wasm`. Після сьогоднішньої правки
воркер відмовляється від SwiftShader і чесно падає на wasm, тож поки карта не запрацює, підпис буде `CPU`.

## Стан коду на момент передачі

- `flake.nix`: додано `vulkan-loader` (лишити).
- `vite.renderer.config.mts`: `.direnv` виключено зі спостерігача.
- `src/main.ts`: `gpu-disk-cache-size-kb` 512 MB; `child-process-gone` → `gpu.log` і повідомлення в вікно.
- `src/worker.ts`: відмова від програмних адаптерів, назва адаптера в `ready`.
- `src/App.tsx`: статус показує адаптер із воркера.
- `CLAUDE.md`: gotchas виправлено; старі твердження про «перевірено на NVIDIA» прибрані як хибні.
- `docs/first-run.md`: план прогріву й чесного індикатора першого запуску, робити після того, як карта
  запрацює.

## Правила роботи, щоб не наступити знову

- Під час прогону нічого не писати в `src/` і не запускати prettier по `src/`.
- Тимчасові файли тільки в scratchpad поза проєктом.
- Після кожної зміни оточення: `direnv reload && npm start` у тому самому терміналі. Внутрішній перезапуск
  Forge (`rs`) оточення не оновлює.
- `nvidia-smi | grep electron` не працює: командний рядок обрізаний. Шукати за PID, як вище.
