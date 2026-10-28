{
  description = "MagScribe — video converter and transcriber";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # The release this flake installs and the sha256 of its .deb. Not package.json's version: that one moves
      # with every commit, and the hash exists only once the release does — so the two are bumped together
      # afterwards. See "Release" in CLAUDE.md.
      release = {
        version = "0.9.4";
        hash = "sha256-vbbB41XQ8+WdmLSAKjicOS2oXFNGHH70IIh+T1f7qYI=";
      };
      releases = "https://github.com/OleksandrCEO/MagScribe/releases/download";
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 ];

          # The Electron binary npm downloads is a plain FHS build and looks for libatk, libgtk и co.
          # in /usr/lib, which NixOS does not have. nix-ld resolves them from this list instead.
          NIX_LD = pkgs.lib.fileContents "${pkgs.stdenv.cc}/nix-support/dynamic-linker";
          # /run/opengl-driver/lib first: the system GPU driver has to win over mesa, or Vulkan (and with it
          # WebGPU) fails to initialise inside the shell. The rest of the list is shared with the packaged
          # build — see nix/electron-libs.nix for what is in it and why.
          NIX_LD_LIBRARY_PATH =
            "/run/opengl-driver/lib:" + pkgs.lib.makeLibraryPath (import ./nix/electron-libs.nix pkgs);
        };
      });

      # The installable app, for a NixOS config that takes this repository as an input. npm cannot run inside
      # a Nix build (it needs the network), so this takes the electron-forge output a release already carries —
      # /usr/lib/magscribe inside its .deb — and wraps it the way `nix-build nix/magscribe.nix` wraps a local
      # `out/`.
      packages = forAllSystems (pkgs: {
        default = import ./nix/magscribe.nix {
          inherit pkgs;
          inherit (release) version;
          app = pkgs.runCommand "magscribe-${release.version}-deb" { nativeBuildInputs = [ pkgs.dpkg ]; } ''
            dpkg-deb --fsys-tarfile ${
              pkgs.fetchurl {
                url = "${releases}/v${release.version}/magscribe-${release.version}-linux-x64.deb";
                inherit (release) hash;
              }
            } | tar -x --no-same-owner ./usr/lib/magscribe
            mv usr/lib/magscribe $out
          '';
        };
      });
    };
}
