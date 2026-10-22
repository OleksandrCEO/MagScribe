# Every shared library the npm Electron binary links against, in one place: nix-ld feeds them to the dev run
# (`flake.nix`) and autoPatchelfHook links the packaged build against them (`nix/magscribe.nix`). Keep the two
# in sync by keeping the list here — `patchelf --print-needed` over `out/magscribe-linux-x64` says what is
# missing if Electron ever gains a dependency.
#
# vulkan-loader is the odd one out, and it is not what makes WebGPU work: Electron ships its own libvulkan.so.1
# next to the binary and finds it through $ORIGIN before anything on the library path. Keep the two apart —
# nixpkgs' loader is built with SYSCONFDIR=/run/opengl-driver/share, where every ICD manifest names its driver by
# an absolute /nix/store path that Chromium's GPU sandbox will not open, while Electron's own loader keeps the
# upstream /etc default, which is the directory the sandbox does allow. See nix/magscribe.nix.
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
