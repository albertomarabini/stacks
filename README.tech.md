find . -type f -print0 | xargs -0 -I{} sh -c 'printf "\n\n---\n# %s\n\n" "$1"; cat "$1"' _ {} > ALL_FILES.txt


# Tree

( command -v tree >/dev/null \
  && tree -a -d -I '.git|node_modules|dist|build|.next|coverage|.cache|out|tmp' -L 6 --dirsfirst \
  || find . -type d -mindepth 1 -maxdepth 6 \( -name .git -o -name node_modules -o -name dist -o -name build -o -name .next -o -name coverage -o -name .cache -o -name out -o -name tmp \) -prune -o -print \
       | sed 's#^\./##' | awk -F/ '{pad=""; for(i=1;i<NF;i++) pad=pad "│   "; print pad "├── " $NF}' \
) | tee prj_tree.txt


# Tree (w filenames)

( command -v tree >/dev/null \
  && tree -a -I '.git|node_modules|dist|build|.next|coverage|.cache|out|tmp' -L 6 --dirsfirst \
  || find . -mindepth 1 -maxdepth 6 \( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './build' -o -path './.next' -o -path './coverage' -o -path './.cache' -o -path './out' -o -path './tmp' \) -prune -o -print \
       | sed 's#^\./##' | awk -F/ '{pad=""; for(i=1;i<NF;i++) pad=pad "│   "; print pad "├── " $NF}' \
) | tee prj_tree.txt

