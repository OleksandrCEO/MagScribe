# Turns the electron-forge output into an app NixOS can install: the FHS binaries get patchelf'd against the
# store, the launcher carries what Electron only dlopens, and a desktop entry puts MagScribe in the menu.
#
# The npm side stays outside Nix — it needs the network and a writable node_modules — so this is two steps:
#
#   npm run package
#   nix-build nix/magscribe.nix -o /tmp/magscribe-result && nix profile install /tmp/magscribe-result
#
# Upgrading later is the same pair of commands plus `nix profile upgrade magscribe`.
let
  # The same nixpkgs the dev shell runs on. Taking it from flake.lock instead of <nixpkgs> keeps the packaged
  # app on the revision the app was built and tested against, and costs no download: the flake already put that
  # source in the store, and fetchTarball finds it there by hash.
  locked = (builtins.fromJSON (builtins.readFile ../flake.lock)).nodes.nixpkgs.locked;
  lockedNixpkgs = builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/${locked.rev}.tar.gz";
    sha256 = locked.narHash;
  };
in
{
  pkgs ? import lockedNixpkgs { },
  # Where electron-forge writes; the directory is named after productName in package.json.
  app ? ../out/transcriber-linux-x64,
}:

let
  inherit (builtins.fromJSON (builtins.readFile ../package.json)) version;

  # The Wayland app_id Electron reports is app.getName(), i.e. productName. KDE ties a window to its menu entry
  # (and with it the taskbar icon) by matching that against the desktop file's name, so both must stay this.
  appId = "transcriber";
in
pkgs.stdenv.mkDerivation {
  pname = "magscribe";
  inherit version;
  src = app;

  nativeBuildInputs = with pkgs; [
    autoPatchelfHook
    copyDesktopItems
    makeWrapper
  ];

  # Only the lib outputs: patchelf needs the shared objects, never the headers, and asking for the default
  # output would drag in half a dozen packages the dev shell never built.
  buildInputs = map pkgs.lib.getLib (import ./electron-libs.nix pkgs);

  # Electron loads these by soname at runtime rather than linking them, so autoPatchelfHook cannot find them on
  # its own and they have to go into the RUNPATH by hand. libGL is libglvnd, which owns the libEGL.so.1 dispatch
  # library: /run/opengl-driver/lib holds only the vendor halves (libEGL_nvidia, libEGL_mesa), so without this
  # the GPU process fails every EGL display type and exits during initialisation. libnotify decides whether
  # Notification.isSupported().
  #
  # nixpkgs' vulkan-loader deliberately does NOT belong here, even though Electron dlopens libvulkan.so.1: it is
  # built with SYSCONFDIR=/run/opengl-driver/share, and every ICD manifest there names its driver by an absolute
  # /nix/store path that Chromium's GPU sandbox refuses to open — the loader then reports "Found no drivers" and
  # WebGPU drops to SwiftShader. Electron ships its own loader next to the binary with the upstream /etc default,
  # which is exactly where the sandbox does allow a manifest, so leave that one to win the RUNPATH.
  runtimeDependencies = map pkgs.lib.getLib (with pkgs; [
    libGL
    libnotify
  ]);

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/magscribe
    cp -r . $out/lib/magscribe/
    chmod -R a+rX $out/lib/magscribe

    install -Dm644 ${../assets/icon.png} $out/share/icons/hicolor/512x512/apps/${appId}.png

    runHook postInstall
  '';

  postFixup = ''
    makeWrapper $out/lib/magscribe/transcriber $out/bin/magscribe \
      --prefix LD_LIBRARY_PATH : /run/opengl-driver/lib \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.ffmpeg ]} \
      --add-flags "--force-device-scale-factor=1"
  '';

  # PATH above is how the app finds ffmpeg: it ships none of its own, because the prebuilt static builds are
  # GPLv3 and conveying one would oblige us to publish matching sources for every library inside it — for
  # encoders this app never calls. nixpkgs' ffmpeg is the user's own copy, so nothing is conveyed.
  #
  # /run/opengl-driver/lib above is not decoration: Chromium's GPU process dlopens libGLX_nvidia.so.0 by soname
  # before it enters its sandbox, and that is the copy the Vulkan ICD manifest in /etc/vulkan/icd.d resolves to.
  # Drop it and WebGPU falls back to SwiftShader on the CPU. The scale-factor flag is for KDE Wayland, which
  # otherwise counts the display scale twice and renders the window about four times too large.

  desktopItems = [
    (pkgs.makeDesktopItem {
      name = appId;
      desktopName = "MagScribe";
      genericName = "Транскрибація відео та аудіо";
      comment = "Транскрибація відео й аудіо локально на цій машині";
      exec = "magscribe";
      icon = appId;
      terminal = false;
      categories = [
        "AudioVideo"
        "Utility"
      ];
      startupWMClass = appId;
    })
  ];

  meta = {
    description = "Local-first desktop app that converts video/audio files and transcribes them";
    mainProgram = "magscribe";
    platforms = [ "x86_64-linux" ];
  };
}
