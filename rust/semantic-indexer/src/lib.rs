mod cli;
mod discovery;
mod embedding;
mod extract;
mod ids;
mod indexer;
mod metadata;
mod model;
mod parser;

pub use cli::run_cli;
pub use embedding::build_embedding_records;
pub use indexer::{
    extract_symbols_from_source, extract_symbols_from_source_with_language, index_source_files,
};
pub use model::{EmbeddingRecord, Language, Position, Range, SymbolKind, SymbolRecord};
