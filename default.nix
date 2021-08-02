{ pkgs ? import <nixpkgs> { } }:
let
  pulumiInstall = pkgs.writeShellScriptBin "pulumi-install" ''
    set -e
    ${pkgs.curl}/bin/curl -fsSL https://get.pulumi.com | sh
    ${pkgs.nodejs}/bin/npm install
  '';
in
pkgs.stdenv.mkDerivation {
  name = "pulumi-env";
  buildInputs = with pkgs; [ awscli nodejs pulumiInstall ];
  shellHook = ''
    if [ ! -d "$HOME/.pulumi" ] || [ ! -d "./node_modules" ]
    then
      pulumi-install
    fi
    export PATH="$HOME/.pulumi/bin:$PATH"
  '';
}
