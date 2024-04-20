This project references every package in the monorepo, so `tsc` can type-check
everything at once. What's great about doing it like this is: (1) you only need
a single tsc process, and (2) any file paths in errors are relative to the root
of the monorepo.
