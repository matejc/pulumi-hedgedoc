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
  buildInputs = with pkgs; [ nodejs pulumiInstall ];
  shellHook = ''
    export PATH="$HOME/.pulumi/bin:$PATH"
  '';
}
