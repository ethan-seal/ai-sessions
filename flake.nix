{
  description = "ai-sessions - browse and search Claude Code, OpenCode, and Codex sessions";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.stdenv.mkDerivation {
            pname = "ai-sessions";
            version = "2.0.0";
            src = ./.;

            nativeBuildInputs = [ pkgs.makeWrapper ];

            installPhase = ''
              runHook preInstall

              mkdir -p $out/lib/ai-sessions
              cp -r src package.json $out/lib/ai-sessions/

              mkdir -p $out/bin
              makeWrapper ${pkgs.bun}/bin/bun $out/bin/ai-sessions \
                --add-flags "run $out/lib/ai-sessions/src/index.ts"

              runHook postInstall
            '';

            meta = {
              description = "Browse and search Claude Code, OpenCode, and Codex sessions";
              license = pkgs.lib.licenses.mit;
              mainProgram = "ai-sessions";
            };
          };
        });

      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.biome
              pkgs.bun
            ];
          };
        });
    };
}
