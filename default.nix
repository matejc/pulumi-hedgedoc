{ pkgs ? import <nixpkgs> {  } }:

pkgs.stdenv.mkDerivation {
  name = "pulumi-env";
  buildInputs = with pkgs; [ nodejs pulumi-bin ];
  shellHook = ''
    read -p "Shell (empty for bash): " newshell
    if [ ! -z "$newshell" ]
    then
      exec $newshell
    fi
  '';
}
