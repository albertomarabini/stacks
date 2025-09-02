find . -type f -print0 | xargs -0 -I{} sh -c 'printf "\n\n---\n# %s\n\n" "$1"; cat "$1"' _ {} > ALL_FILES.txt
