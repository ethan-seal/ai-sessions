{
  description = "ai-sessions - browse and search Claude Code and OpenCode sessions";

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
              cp src/index.ts $out/lib/ai-sessions/
              cp package.json $out/lib/ai-sessions/

              mkdir -p $out/bin
              makeWrapper ${pkgs.bun}/bin/bun $out/bin/ai-sessions \
                --add-flags "run $out/lib/ai-sessions/index.ts"

              runHook postInstall
            '';

            meta = {
              description = "Browse and search Claude Code and OpenCode sessions";
              license = pkgs.lib.licenses.mit;
              mainProgram = "ai-sessions";
            };
          };
        });

      homeManagerModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.ai-sessions-backup;
        in
        {
          options.services.ai-sessions-backup = {
            enable = lib.mkEnableOption "automatic AI sessions backups";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
              description = "The ai-sessions package to use.";
            };

            frequency = lib.mkOption {
              type = lib.types.str;
              default = "daily";
              description = "systemd calendar expression for backup frequency.";
            };

            keep = lib.mkOption {
              type = lib.types.int;
              default = 10;
              description = "Number of backups to retain.";
            };

            destination = lib.mkOption {
              type = lib.types.str;
              default = "~/.ai-sessions-backups";
              description = "Directory to store backups in.";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.user.services.ai-sessions-backup = {
              Unit.Description = "AI Sessions Backup";
              Service = {
                Type = "oneshot";
                ExecStart = "${cfg.package}/bin/ai-sessions backup --dest ${cfg.destination} --keep ${toString cfg.keep}";
              };
            };

            systemd.user.timers.ai-sessions-backup = {
              Unit.Description = "Daily AI Sessions Backup";
              Timer = {
                OnCalendar = cfg.frequency;
                Persistent = true;
              };
              Install.WantedBy = [ "timers.target" ];
            };
          };
        };
    };
}
