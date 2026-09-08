{
  description = "MagScribe — local video converter and transcriber";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 ];

          # The Electron binary npm downloads is a plain FHS build and looks for libatk, libgtk и co.
          # in /usr/lib, which NixOS does not have. nix-ld resolves them from this list instead.
          NIX_LD = pkgs.lib.fileContents "${pkgs.stdenv.cc}/nix-support/dynamic-linker";
          # /run/opengl-driver/lib first: the system GPU driver has to win over mesa, or Vulkan (and with it
          # WebGPU) fails to initialise inside the shell.
          NIX_LD_LIBRARY_PATH = "/run/opengl-driver/lib:" + pkgs.lib.makeLibraryPath (with pkgs; [
            alsa-lib at-spi2-atk at-spi2-core atk cairo cups dbus expat glib gtk3
            libdrm libgbm libGL libxkbcommon mesa nspr nss pango stdenv.cc.cc.lib systemd
            libx11 libxcomposite libxdamage libxext libxfixes
            libxrandr libxscrnsaver libxtst libxcb
          ]);
        };
      });
    };
}
