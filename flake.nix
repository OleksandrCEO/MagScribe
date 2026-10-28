{
  description = "MagScribe — video converter and transcriber";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # The release this flake installs. Not package.json's version: that one moves with every commit, and the
      # hash can only be taken once the release's tarball exists — so the two are bumped together afterwards.
      # See "Release" in CLAUDE.md.
      release = {
        version = "0.9.4";
        hash = "sha256-PTidY01v6VpU5Z59qlHLSMOL292+sikGnuPZQZjR6qI=";
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
      # a Nix build (it needs the network), so the electron-forge output is a release asset and this only wraps
      # it — the same wrapper `nix-build nix/magscribe.nix` applies to a local `out/`.
      packages = forAllSystems (pkgs: {
        default = import ./nix/magscribe.nix {
          inherit pkgs;
          inherit (release) version;
          app = pkgs.fetchzip {
            url = "${releases}/v${release.version}/magscribe-${release.version}-linux-x64.tar.gz";
            inherit (release) hash;
          };
        };
      });
    };
}
