# Every shared library the npm Electron binary links against, in one place: nix-ld feeds them to the dev run
# (`flake.nix`) and autoPatchelfHook links the packaged build against them (`nix/magscribe.nix`). Keep the two
# in sync by keeping the list here — `patchelf --print-needed` over `out/transcriber-linux-x64` says what is
# missing if Electron ever gains a dependency.
#
# vulkan-loader is the odd one out: it provides libvulkan.so.1, which NixOS keeps out of /run/opengl-driver/lib
# (only the per-vendor ICDs live there). Without it Electron finds no loader and silently falls back to its
# bundled libvk_swiftshader.so — requestAdapter() still succeeds, so the app reports WebGPU while every matmul
# runs on the CPU inside the GPU process.
pkgs:

with pkgs;
[
  alsa-lib
  at-spi2-atk
  at-spi2-core
  atk
  cairo
  cups
  dbus
  expat
  glib
  gtk3
  libdrm
  libgbm
  libGL
  libnotify
  libxkbcommon
  mesa
  nspr
  nss
  pango
  stdenv.cc.cc.lib
  systemd
  vulkan-loader
  libx11
  libxcomposite
  libxdamage
  libxext
  libxfixes
  libxrandr
  libxscrnsaver
  libxtst
  libxcb
]
