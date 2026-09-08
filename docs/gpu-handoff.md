# WebGPU на NixOS: чому карта не працює, що перевірено, що робити далі

Документ для нового чату. **Мета: транскрибація має рахуватися на відеокарті.** Зараз вона рахується
процесором, а підпис у вікні тижнями писав «WebGPU». Усе нижче перевірено 8 вересня 2026 на цій машині,
команди можна повторювати. Читати повністю перед будь-якою дією: половина сьогоднішнього дня пішла на
висновки, зроблені без цієї інформації.

---

## 1. Оточення (точні дані)

| Що | Значення |
|---|---|
| ОС | NixOS, KDE Plasma, Wayland |
| GPU / драйвер | NVIDIA, драйвер `595.71.05` (nvidia-smi і `/proc/driver/nvidia/version` збігаються) |
| VRAM | 16 380 MiB, зайнято іншими ~6 GB |
| RAM | 46 GB, вільно ~32 GB |
| Electron | `44.2.0` з npm, `node_modules/electron/dist/electron`, непатчений FHS-бінарник |
| Запуск | `npm start` = `electron-forge start -- --force-device-scale-factor=1`, через nix-ld |
| userData | `~/.config/transcriber` (productName `transcriber`, dev і пакет ділять одну теку) |
| Vite | порт 5173, стабільний між запусками |
| Vulkan loader після фіксу | `/nix/store/lk4614327cn1h9z3m6cvnls95n13m1cj-vulkan-loader-1.4.357.0/lib/libvulkan.so.1` |
| ICD NVIDIA | `/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json` → `/nix/store/jvw27qs9lrnmm2yxnvld8kdfg031jfx5-nvidia-x11-595.71.05/lib/libGLX_nvidia.so.0`, api `1.4.329` |
| SwiftShader | `node_modules/electron/dist/libvk_swiftshader.so`, 4,6 MB, завжди присутній |
| Оболонка Claude | `claude-desktop-fhsenv`, це FHS-пісочниця: у ній є `/usr/share/vulkan/icd.d`, а в звичайній оболонці користувача на NixOS його **немає**. Не плутати спостереження з двох оболонок. |

Прапорці Chromium у `src/main.ts` (Linux): `enable-unsafe-webgpu`, `enable-features=Vulkan`,
`disable-gpu-compositing`, плюс `gpu-disk-cache-size-kb=524288` для всіх платформ.

---

## 2. Симптом, як його бачить користувач

- Після «Транскрибувати» смуга стоїть на 0 % десять і більше хвилин.
- Потім текст зʼявляється, але в рази повільніше за реальний час.
- Вентилятори гудуть, у моніторі KDE CPU 100 %, GPU 10–12 % (це робочий стіл і OBS, не ми).
- Підпис унизу вікна казав «Модель готова · WebGPU · q4». Це була неправда.

---

## 3. Хронологія 8 вересня (щоб розуміти, звідки взялися хибні сліди)

| Час | Подія |
|---|---|
| 20:17 | Запуск, транскрибація на 0 %. GPU-процес 77164 на 550 % CPU. Прийнято за компіляцію шейдерів. |
| 20:26 | Знайдено ліміт 6 MB на `DawnWebGPUCache`; коміт `5a4886a` піднімає його. Це правда, але не причина. |
| 20:27–20:41 | Пʼять комітів із правками в `src/`. **Кожен перезапускав Electron або рендерер і вбивав прогін.** Це виглядало як «GPU-процес помирає», і породило хибну гілку про watchdog/OOM. |
| 20:35–20:44 | Кілька перезапусків, GPU-процес щоразу новий. Додано `child-process-gone` у `main.ts`. |
| 20:44 | Останній перезапуск від правки. Далі `src/` не чіпали. Прогін дожив до 26 хвилин, зʼявився текст. |
| 21:03 | Користувач: «схоже, транскрибує процесором». `nvidia-smi`: наш процес тип `G`, 3 MiB. **Це і є діагноз.** |
| 21:08 | Знайдено, що `libvulkan.so.1` відсутній у `NIX_LD_LIBRARY_PATH`. Додано `vulkan-loader` у `flake.nix`. |
| 21:11 | Перезапуск через `rs`/правку **без** `direnv reload` → оточення старе, фікс не випробуваний. |
| 21:14 | `direnv reload && npm start`. Завантажувач є, `-9` лишився. Заодно `.direnv` потрапив у спостерігач Vite. |
| 21:18 | `--ozone-platform=x11`: `-9` лишився, вікно крихітне. Гіпотеза про композитор закрита. |
| 21:26 | `VK_ICD_FILENAMES=…nvidia_icd.json npm start`: Dawn пише `Failed to open JSON file`. **Пісочниця.** |

Мораль хронології: три з чотирьох «загадок» дня (смерть GPU-процесу, кеш, що не пишеться, «компіляція по
20 хвилин») були наслідками того, що ми правили код під час прогону або що адаптер програмний.

---

## 4. Що доведено (з командами й результатами)

### 4.1. Адаптер програмний (SwiftShader), а не NVIDIA

```bash
for p in $(pgrep -f 'dist/electron --type=gpu-process'); do nvidia-smi | grep " $p "; done
# |    0   N/A  N/A   82553   G   ...rack-uuid=3190708988185955192   3MiB |
```

Для порівняння в тому самому виводі: Obsidian (Electron з nixpkgs) `C+G` 192 MiB, OBS `C+G` 581 MiB.
Ваги Whisper turbo q4 важать ~450 MB; якби вони були на карті, ми б бачили сотні MiB і тип `C`.

```bash
ps -T -p <gpu pid> -o tid,pcpu,comm | sort -k2 -rn | head
#  77257 72.7 Thread<03>   … вісім потоків Thread<00>..Thread<07> по 70–90 %
```

`Thread<NN>` не є потоками Chromium (ті звуться `ThreadPoolForeg`, `VizCompositorTh`). Це воркери
SwiftShader, що JIT-компілюють шейдери на CPU.

Побічний доказ: адаптер не мав `shader-f16`. Коментар у старому `worker.ts` списував це на «NVIDIA під
Vulkan», але NVIDIA його підтримує (`VK_KHR_shader_float16_int8`), а SwiftShader ні.

### 4.2. Завантажувача Vulkan не було

```bash
ls /run/opengl-driver/lib/libvulkan*      # лише libvulkan_intel.so, libvulkan_radeon.so … (це ICD, не loader)
for d in $(echo "$NIX_LD_LIBRARY_PATH" | tr ':' ' '); do [ -e "$d/libvulkan.so.1" ] && echo "$d"; done   # порожньо до фіксу
ls -d /nix/store/*vulkan-loader*/lib      # є в store, але ніщо в flake його не тягнуло
```

Фікс: `vulkan-loader` у списку `makeLibraryPath` у `flake.nix`. Після `direnv reload`:

```bash
echo $NIX_LD_LIBRARY_PATH | tr ':' '\n' | grep vulkan
# /nix/store/lk4614327cn1h9z3m6cvnls95n13m1cj-vulkan-loader-1.4.357.0/lib
```

Необхідно (без нього `vkCreateInstance` неможливий у принципі), але **не достатньо**.

### 4.3. ICD NVIDIA існує, валідний, бібліотека на місці

```bash
python3 -c "import json;print(json.load(open('/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json'))['ICD'])"
# {'library_path': '/nix/store/jvw27…-nvidia-x11-595.71.05/lib/libGLX_nvidia.so.0', 'api_version': '1.4.329'}
ls -la /nix/store/jvw27qs9lrnmm2yxnvld8kdfg031jfx5-nvidia-x11-595.71.05/lib/libGLX_nvidia.so.0   # symlink на .595.71.05, існує
```

### 4.4. GPU-процес Chromium не може відкрити ICD (пісочниця)

```bash
VK_ICD_FILENAMES=/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json npm start
```

```
Warning: loader_get_json: Failed to open JSON file /run/opengl-driver/share/vulkan/icd.d/nvidia_icd.json
Warning: vkCreateInstance: Found no drivers!
Warning: vkCreateInstance failed with VK_ERROR_INCOMPATIBLE_DRIVER
    at CheckVkSuccessImpl (../../third_party/dawn/src/dawn/native/vulkan/VulkanError.cpp:106)
```

Три факти в цих рядках:

1. Стек іде з **Dawn** (`third_party/dawn/.../vulkan/`), тобто це шлях WebGPU, а не композитора.
2. Завантажувач узяв саме той шлях, що ми дали, і **не зміг відкрити файл**, який той самий користувач читає
   поза Electron. Це не «не знайдено», це «відмовлено».
3. Dawn створює інстанс Vulkan ліниво, при першому `requestAdapter()`, коли пісочниця GPU-процесу вже
   ввімкнена. Pre-sandbox хук Chromium підвантажує бібліотеки GL/NVIDIA, але маніфест ICD читається пізніше,
   зсередини.

Chromium-пісочниця GPU-процесу пускає до `/usr/share/vulkan/icd.d` і `/etc/vulkan/icd.d`, яких на NixOS
нема, і не пускає до `/run/opengl-driver`. nixpkgs патчить Chromium/Electron саме на це. npm-бінарник
непатчений. **Це поточна робоча гіпотеза; вона пояснює всі спостереження, але ще не підтверджена прямим
експериментом (див. кандидат C).**

### 4.5. Що робить `vkCreateInstance() failed: -9` у логу без `VK_ICD_FILENAMES`

`-9` = `VK_ERROR_INCOMPATIBLE_DRIVER`: завантажувач є, драйверів не знайшов. Рядок із `gpu/vulkan/vulkan_instance.cc`
належить Vulkan-композитору Chromium; той самий стан у Dawn видно лише зі змінною `VK_ICD_FILENAMES` (тоді
loader стає балакучий). Обидва кажуть одне й те саме: ICD недосяжний.

---

## 5. Хибні висновки дня і чому вони були хибними

| Висновок | Чому здавався правильним | Чому хибний |
|---|---|---|
| «WebGPU працює, перевірено на NVIDIA» (старий `CLAUDE.md`) | `requestAdapter()` повертав адаптер, статус писав WebGPU, чанки йшли | Адаптер був SwiftShader. Ніхто не дивився в `nvidia-smi`. |
| «NVIDIA під Vulkan не має shader-f16» (старий коментар у `worker.ts`) | Адаптер справді не мав фічі | Фічі не мав SwiftShader. NVIDIA її має. |
| «int8-енкодер у 9 разів повільніший за q4 на цій карті» | Виміряно | Виміряно на CPU через SwiftShader. Про GPU нічого не відомо. |
| «Це компіляція шейдерів, треба чекати» | GPU-процес на 500 % CPU, 0 % на смузі | Так, але компілював SwiftShader, тому «хвилини» стали десятками хвилин. |
| «GPU-процес помирає» (watchdog/OOM) | pid GPU-процесу мінявся щоразу | Його перезапускали наші ж правки в `src/` через Forge/Vite. `gpu.log` порожній. |
| «`-9` це тільки композитор, на WebGPU не впливає» | Рядок із `gpu/vulkan/`, а не з Dawn | Dawn мовчить без `VK_ICD_FILENAMES`; той самий `-9` є і в нього. |
| «Під Wayland Chromium забороняє Vulkan, треба x11» | Chromium сам це радить у першому рядку | Під x11 той самий `-9`. Вікно ламається. Не повторювати. |
| «Кеш шейдерів не пишеться, бо 6 MB ліміт» | Кеш на диску рівно ~5,8 MB | Ліміт реальний, але кеш не дописувався ще й тому, що прогони вбивали перезапуски. І він не допоможе, поки адаптер програмний. |
| «`direnv reload` підхопився» | Команду виконали | Перший раз перезапуск був через `rs` у старій оболонці. Перевіряти `echo $NIX_LD_LIBRARY_PATH`. |
| «`nvidia-smi \| grep electron` покаже наш процес» | Логічно | Командний рядок у виводі обрізаний, слова `electron` там нема. Шукати за PID. |

---

## 6. Що виключено, не повертатися

- `--ozone-platform=x11`: не допомагає, ламає HiDPI.
- `use-angle=gl`, `use-gl=egl`: старі спроби, теж робилися без завантажувача, тобто нічого не доводять, але й
  надії не дають: проблема не в GL.
- Композитор/Wayland як причина.
- Watchdog, OOM, падіння драйвера: памʼяті вдосталь, `gpu.log` порожній, `dmesg`/journal без записів.
- Кеш шейдерів як причина повільності: наслідок, не причина.
- Пакування `npm run make` як спосіб уникнути компіляції: компіляція йде в рантаймі на машині користувача.

---

## 7. Кандидати на рішення, за пріоритетом

### A. Electron із nixpkgs замість npm-бінарника (найімовірніше правильне для NixOS)

nixpkgs збирає Electron із патчами під `/run/opengl-driver`, і саме тому Obsidian бачить карту. npm-пакет
`electron` поважає змінну `ELECTRON_OVERRIDE_DIST_PATH`: якщо вона вказує на теку з бінарником, `require('electron')`
віддає його, і Forge запускає його.

Кроки:

1. Версія в nixpkgs: `nix eval --raw nixpkgs#electron.version` (потрібна та сама мажорна, що в npm: 44).
   Якщо в unstable інша, шукати `electron_44` або взяти nixpkgs-версію і синхронно змінити npm-версію.
2. У `flake.nix` devShell: `packages = [ pkgs.nodejs_24 pkgs.electron_44 ];` і
   `ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron_44}/libexec/electron";`
3. `direnv reload && npm start` у тому самому терміналі.
4. Перевірка з розділу 8.

Ризики: інша мінорна версія Chromium, ніж у npm; nix-ld для цього бінарника не потрібен, а `NIX_LD_LIBRARY_PATH`
може навіть заважати (якщо щось дивне, спробувати без нього). Для `npm run make` це не потрібно: на
Ubuntu/Windows `/usr/share/vulkan/icd.d` існує і пісочниця туди пускає. **Це припущення, перевірити на іншій
машині перед тим, як обіцяти.**

### B. Підкласти ICD туди, куди пісочниця пускає

`/etc` на NixOS керований: у `configuration.nix`
`environment.etc."vulkan/icd.d/nvidia_icd.json".source = "${config.hardware.nvidia.package}/share/vulkan/icd.d/nvidia_icd.json";`
(точний атрибут пакета звірити). Після `nixos-rebuild switch` маніфест лежить у `/etc/vulkan/icd.d`, куди
пісочниця пускає. Але маніфест вказує на бібліотеку в `/nix/store`, і її треба `dlopen`-ити зсередини
пісочниці. Chromium підвантажує бібліотеки NVIDIA до входу в пісочницю для GL (`content/gpu/gpu_sandbox_hook_linux.cc`,
функції на кшталт `LoadNvidiaLibraries`/`LoadVulkanLibraries`); чи покриває це ICD Vulkan, дивитися в
джерелі. Якщо ні, B не спрацює сам, і треба ще дозвіл на `/nix/store` (це знову патч Chromium, тобто варіант A).

### C. Лише діагностика: `--disable-gpu-sandbox`

```bash
npm start -- --disable-gpu-sandbox
```

Один запуск. Якщо карта зʼявиться (`C+G`, сотні MiB, підпис `WebGPU · nvidia …`), гіпотеза про пісочницю
доведена точно, і далі йдемо в A або B. Якщо й без пісочниці карти нема, гіпотеза хибна, і треба
`--enable-logging=stderr --v=1` і читати все навколо `vulkan`/`dawn`.

**Це послаблення безпеки. У реліз не йде. Рішення про запуск приймаємо разом, не мовчки.**

### D. Якщо все впирається в непатчений бінарник і A неможливий

Зібрати Electron-пакет через nix (`pkgs.electron` як `extraResource`? ні, це не так працює) або перейти на
запуск через `steam-run`/`nix-ld` з розширеною FHS-пісочницею, де є `/usr/share/vulkan/icd.d`. Це важкий
шлях, розглядати останнім.

---

## 8. Як перевіряти результат (єдиний надійний спосіб)

```bash
for p in $(pgrep -f 'dist/electron --type=gpu-process'); do nvidia-smi | grep " $p "; done
```

Потрібно: тип `C+G`, сотні MiB. Зараз: `G`, 3 MiB.

Додаткові знаки, самі по собі не достатні:

- у логу `npm start` немає `vkCreateInstance() failed: -9` і `Found no drivers!`;
- підпис унизу вікна `WebGPU · nvidia …`, а не `CPU · wasm` (після сьогоднішньої правки воркер відмовляється
  від SwiftShader і чесно падає на wasm; підпис береться з `adapter.info`);
- під час транскрибації GPU-процес на десятках відсотків CPU, а не сотнях; `nvidia-smi` показує завантаження.

Перший прогін на справжній карті теж компілюватиме шейдери, але хвилину-дві, не двадцять. Кеш після цього
дописується, ліміт піднятий. Далі перший чанк секунди.

---

## 9. Стан коду на момент передачі

| Файл | Зміна |
|---|---|
| `flake.nix` | `vulkan-loader` у `NIX_LD_LIBRARY_PATH`, з коментарем про симптом. Лишити. |
| `vite.renderer.config.mts` | `.direnv` виключено зі спостерігача Vite. |
| `src/main.ts` | `gpu-disk-cache-size-kb=524288`; `child-process-gone` → `userData/gpu.log` + повідомлення в вікно. |
| `src/worker.ts` | `pickWebGpu()`: відмова від `isFallbackAdapter` і адаптерів `swiftshader/llvmpipe/lavapipe/warp`, падіння на wasm; `ready` несе `adapter` і `encoder`. |
| `src/App.tsx` | статус показує `model.adapter`; тип `Device` більше не імпортується. |
| `CLAUDE.md` | gotchas переписані; хибні твердження прибрані. |
| `docs/first-run.md` | план прогріву й чесного індикатора першого запуску. Робити **після** того, як карта запрацює, інакше прогріватимемо CPU. |

Коміти дня в порядку: `c9cf495` (аркуш), `6e685f2` (капсула/OGG/тема), `5a4886a` (кеш 6 MB), `3a3e91d`
(`child-process-gone`), далі цей коміт із чесністю адаптера й документами.

---

## 10. Правила роботи, щоб не наступити знову

1. **Під час прогону `src/` не чіпати.** Ні редактором, ні `sed`, ні prettier. Forge перезапускає Electron
   на зміну `main.ts`/`preload.ts`, Vite перезавантажує рендерер на зміну будь-чого в рендерері. Обидва
   вбивають прогін і лишають кеш недописаним.
2. Тимчасові файли тільки в scratchpad поза проєктом. Документи в `docs/` безпечні (Vite їх не стежить),
   але `flake.nix` після правки потребує `direnv reload`.
3. Після зміни оточення: `direnv reload && npm start` **у тому самому терміналі**. `rs` у Forge оточення не
   оновлює. Перевіряти `echo $NIX_LD_LIBRARY_PATH | tr ':' '\n' | grep vulkan`.
4. `nvidia-smi | grep electron` не працює. Шукати за PID (розділ 8).
5. Не вірити підпису у вікні і `requestAdapter() !== null`. Вірити `nvidia-smi`.
6. Оточення Electron-процесів (`/proc/<pid>/environ`, `maps`, `fd`) з оболонки Claude не читається. Не
   витрачати на це час; просити користувача виконати `echo $VAR` у його терміналі.
7. Не змінювати композитор (`ozone-platform`). Не пропонувати `--no-sandbox`. `--disable-gpu-sandbox` лише як
   разова діагностика за спільним рішенням.
8. Мережеві команди: 40 секунд і один повтор, бо OpenSnitch. `WebFetch` на `raw.githubusercontent.com`
   іноді падає з порожньою помилкою, повтор допомагає.

---

## 11. Відкриті питання для нового чату

- Чи справді пре-sandbox хук Chromium підвантажує ICD Vulkan (дивитися `gpu_sandbox_hook_linux.cc` у
  Chromium 134, який в Electron 44)?
- Яка версія Electron у nixpkgs-unstable зараз, і чи є `electron_44`?
- Чи працює WebGPU в зібраному пакеті на Ubuntu/Windows без жодних цих танців (гіпотеза: так, бо там є
  `/usr/share/vulkan/icd.d`)?
- Після появи карти: перевиміряти fp16 проти q4 для енкодера, бо всі старі цифри з CPU.
- Після появи карти: зробити `docs/first-run.md` (прогрів + індикатор).
