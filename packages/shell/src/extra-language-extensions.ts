/**
 * Marketplace language packs under /extensions/* (Open VSX).
 * Keep dest names in sync with product/extra-language-extensions.json.
 */
export const EXTRA_LANGUAGE_EXTENSION_DESTS: readonly string[] = [
  'terraform',
  'hcl',
  'nix',
  'kotlin',
  'scala',
  'elixir',
  'haskell',
  'solidity',
  'zig',
  'fortran',
  'cobol',
  'pascal',
  'abap',
  'verilog',
  'vhdl',
  'gleam',
  'crystal',
  'erlang',
  'assembly',
  'matlab',
  'scheme',
  'prolog',
  'gdscript',
  'ocaml',
  'sas',
  'lisp',
];

/** Absolute paths for additionalBuiltinExtensions. */
export function extraLanguageExtensionPaths(): string[] {
  return EXTRA_LANGUAGE_EXTENSION_DESTS.map((id) => `/extensions/${id}`);
}
