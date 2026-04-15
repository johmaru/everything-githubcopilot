use std::path::{Path, PathBuf};

use anyhow::Result;
use anyhow::anyhow;

use crate::discovery::{language_for_path, normalize_path};
use crate::extract::collect_symbols;
use crate::ids::{assign_stable_ids, sort_symbols};
use crate::model::{Language, SymbolRecord};
use crate::parser::ParserSet;

pub fn extract_symbols_from_source(source: &str, file_path: &str) -> Result<Vec<SymbolRecord>> {
    extract_symbols_from_source_with_language(source, file_path, Language::Typescript)
}

pub fn extract_symbols_from_source_with_language(
    source: &str,
    file_path: &str,
    language: Language,
) -> Result<Vec<SymbolRecord>> {
    let mut parsers = ParserSet::default();
    extract_symbols_with_parsers(source, file_path, language, &mut parsers)
}

pub fn index_source_files(root: &Path, files: &[PathBuf]) -> Result<Vec<SymbolRecord>> {
    let mut symbols = Vec::new();
    let mut parsers = ParserSet::default();

    for file_path in files {
        let source = std::fs::read_to_string(file_path)?;
        let normalized_path = normalize_path(root, file_path);
        let language = language_for_path(file_path)?;
        symbols.extend(extract_symbols_with_parsers(
            &source,
            &normalized_path,
            language,
            &mut parsers,
        )?);
    }

    sort_symbols(&mut symbols);
    Ok(symbols)
}

fn extract_symbols_with_parsers(
    source: &str,
    file_path: &str,
    language: Language,
    parsers: &mut ParserSet,
) -> Result<Vec<SymbolRecord>> {
    let parser = parsers.parser_for(language)?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| anyhow!("failed to parse {file_path}"))?;

    let mut symbols = collect_symbols(tree.root_node(), source, file_path, language)?;
    sort_symbols(&mut symbols);
    assign_stable_ids(&mut symbols);
    Ok(symbols)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SymbolKind;

    #[test]
    fn extracts_module_function_and_class_symbols_from_inline_typescript() {
        let source = r#"
/** Example module */
export function greet(name: string): string {
    return `hello ${name}`;
}

export class Greeter {
    greet(): string {
        return greet("world");
    }
}
"#;

        let symbols = extract_symbols_from_source(source, "fixtures/example.ts").unwrap();

        assert_eq!(
            symbols.len(),
            3,
            "module + function + class should be extracted"
        );
        assert_eq!(symbols[0].language, Language::Typescript);
        assert_eq!(symbols[0].kind, SymbolKind::Module);
        assert_eq!(symbols[0].name, "fixtures/example.ts");
        assert_eq!(symbols[1].kind, SymbolKind::Function);
        assert_eq!(symbols[1].name, "greet");
        assert!(symbols[1].is_exported);
        assert_eq!(symbols[2].kind, SymbolKind::Class);
        assert_eq!(symbols[2].name, "Greeter");
        assert_eq!(
            symbols[0].source_text,
            "/** Example module */\nexport function greet(name: string): string {"
        );
        assert!(
            symbols
                .iter()
                .all(|symbol| !symbol.stable_symbol_id.is_empty())
        );
        assert!(symbols.iter().all(|symbol| !symbol.chunk_id.is_empty()));
        assert!(
            symbols
                .iter()
                .all(|symbol| symbol.range.end.byte > symbol.range.start.byte)
        );
    }

    #[test]
    fn extracts_module_class_and_function_symbols_from_inline_python() {
        let source = r#"
#!/usr/bin/env python3
# coding=utf-8
"""Example python module.
With more context.
"""

class Detector:
    """Represents a detector."""

    def match(self) -> bool:
        return True


def parse_spec(path: str) -> str:
    return path
"#;

        let symbols = extract_symbols_from_source_with_language(
            source,
            "fixtures/example.py",
            Language::Python,
        )
        .unwrap();

        assert!(
            symbols
                .iter()
                .any(|symbol| symbol.kind == SymbolKind::Module)
        );
        assert!(symbols.iter().any(|symbol| {
            symbol.kind == SymbolKind::Module
                && symbol.source_text
                    == "\"\"\"Example python module.\nWith more context.\n\"\"\"\nclass Detector:"
        }));
        assert!(symbols.iter().any(|symbol| {
            symbol.kind == SymbolKind::Class
                && symbol.name == "Detector"
                && symbol.language == Language::Python
        }));
        assert!(symbols.iter().any(|symbol| {
            symbol.kind == SymbolKind::Function
                && symbol.name == "parse_spec"
                && symbol.language == Language::Python
        }));
        assert!(symbols.iter().any(|symbol| symbol.doc_comment.is_some()));
        assert!(symbols.iter().any(|symbol| symbol.signature.is_some()));
    }

    #[test]
    fn extracts_module_struct_and_function_symbols_from_inline_rust() {
        let source = r#"
//! Example rust module.

/// Stores parsed output.
pub struct IndexRecord {
    pub id: String,
}

pub fn parse() -> IndexRecord {
    IndexRecord { id: String::from("ok") }
}
"#;

        let symbols = extract_symbols_from_source_with_language(
            source,
            "fixtures/example.rs",
            Language::Rust,
        )
        .unwrap();

        assert!(
            symbols
                .iter()
                .any(|symbol| symbol.kind == SymbolKind::Module)
        );
        assert!(symbols.iter().any(|symbol| {
            symbol.kind == SymbolKind::Module
                && symbol.source_text == "//! Example rust module.\npub struct IndexRecord {"
        }));
        assert!(symbols.iter().any(|symbol| {
            symbol.kind == SymbolKind::Struct
                && symbol.name == "IndexRecord"
                && symbol.language == Language::Rust
                && symbol.is_exported
        }));
        assert!(symbols.iter().any(|symbol| {
            symbol.kind == SymbolKind::Function
                && symbol.name == "parse"
                && symbol.language == Language::Rust
                && symbol.is_exported
        }));
        assert!(symbols.iter().any(|symbol| symbol.signature.is_some()));
        assert!(
            symbols
                .iter()
                .any(|symbol| symbol.source_text.contains("pub struct IndexRecord"))
        );
    }

    #[test]
    fn rust_module_summary_does_not_reuse_outer_item_doc_comments() {
        let source = r#"
/// Renderable capability boundary.
pub trait Renderable {
    fn render(&self) -> String;
}
"#;

        let symbols = extract_symbols_from_source_with_language(
            source,
            "fixtures/trait-doc.rs",
            Language::Rust,
        )
        .unwrap();

        let module_symbol = symbols
            .iter()
            .find(|symbol| symbol.kind == SymbolKind::Module)
            .expect("module symbol should exist");
        let trait_symbol = symbols
            .iter()
            .find(|symbol| symbol.kind == SymbolKind::Trait)
            .expect("trait symbol should exist");

        assert_eq!(module_symbol.doc_comment, None);
        assert!(!module_symbol.has_doc_comment);
        assert_eq!(module_symbol.source_text, "pub trait Renderable {");
        assert_eq!(
            trait_symbol.doc_comment,
            Some(String::from("/// Renderable capability boundary."))
        );
    }

    #[test]
    fn does_not_attach_doc_comment_across_blank_line() {
        let source = r#"
/** Detached comment */

export function loose(): string {
    return "ok";
}
"#;

        let symbols = extract_symbols_from_source(source, "fixtures/detached.ts").unwrap();
        let function_symbol = symbols
            .iter()
            .find(|symbol| symbol.kind == SymbolKind::Function && symbol.name == "loose")
            .expect("function symbol should exist");

        assert_eq!(function_symbol.doc_comment, None);
        assert!(!function_symbol.has_doc_comment);
    }

    #[test]
    fn module_summary_skips_regular_comments_before_code() {
        let source = r#"
// regular comment
/* block comment */

export const meaning = 42;
"#;

        let symbols = extract_symbols_from_source(source, "fixtures/comments.ts").unwrap();
        let module_symbol = symbols
            .iter()
            .find(|symbol| symbol.kind == SymbolKind::Module)
            .expect("module symbol should exist");

        assert_eq!(module_symbol.source_text, "export const meaning = 42;");
    }
}
