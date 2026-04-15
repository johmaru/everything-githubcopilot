use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    Typescript,
    Python,
    Rust,
}

impl Language {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Typescript => "typescript",
            Self::Python => "python",
            Self::Rust => "rust",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Module,
    Function,
    Class,
    Struct,
    Enum,
    Trait,
    Impl,
    TypeAlias,
    Const,
    Static,
    Macro,
    Export,
}

impl SymbolKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Module => "module",
            Self::Function => "function",
            Self::Class => "class",
            Self::Struct => "struct",
            Self::Enum => "enum",
            Self::Trait => "trait",
            Self::Impl => "impl",
            Self::TypeAlias => "type_alias",
            Self::Const => "const",
            Self::Static => "static",
            Self::Macro => "macro",
            Self::Export => "export",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Position {
    pub line: usize,
    pub column: usize,
    pub byte: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SymbolRecord {
    pub language: Language,
    pub file_path: String,
    pub kind: SymbolKind,
    pub name: String,
    pub stable_symbol_id: String,
    pub chunk_id: String,
    pub range: Range,
    pub signature: Option<String>,
    pub doc_comment: Option<String>,
    pub source_text: String,
    pub is_exported: bool,
    pub export_kind: Option<String>,
    pub has_doc_comment: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EmbeddingRecord {
    pub language: Language,
    pub file_path: String,
    pub kind: SymbolKind,
    pub name: String,
    pub stable_symbol_id: String,
    pub chunk_id: String,
    pub signature: Option<String>,
    pub doc_comment: Option<String>,
    pub source_text: String,
    pub is_exported: bool,
    pub has_doc_comment: bool,
    pub text: String,
}
