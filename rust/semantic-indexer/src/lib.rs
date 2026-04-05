use std::ffi::OsString;
use std::path::{Path, PathBuf};

use anyhow::Result;
use anyhow::anyhow;
use clap::Parser as ClapParser;
use clap::ValueEnum;
use serde::Serialize;
use tree_sitter::Node;
use tree_sitter::Parser;
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    Typescript,
    Python,
    Rust,
}

impl Language {
    fn as_str(self) -> &'static str {
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
    Export,
}

impl SymbolKind {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Module => "module",
            Self::Function => "function",
            Self::Class => "class",
            Self::Struct => "struct",
            Self::Enum => "enum",
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum OutputFormat {
    Json,
    Jsonl,
}

#[derive(Debug, ClapParser)]
#[command(name = "semantic-indexer")]
struct CliArgs {
    #[arg(long, default_value = ".")]
    root: PathBuf,
    #[arg(long, value_enum, default_value = "json")]
    format: OutputFormat,
    #[arg(long = "file")]
    files: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy)]
struct ExportContext<'a> {
    export_kind: &'a str,
}

#[derive(Debug, Clone, Copy)]
struct SymbolContext<'a> {
    file_path: &'a str,
    language: Language,
    source: &'a str,
    export_context: Option<ExportContext<'a>>,
}

pub fn extract_symbols_from_source(source: &str, file_path: &str) -> Result<Vec<SymbolRecord>> {
    extract_symbols_from_source_with_language(source, file_path, Language::Typescript)
}

pub fn extract_symbols_from_source_with_language(
    source: &str,
    file_path: &str,
    language: Language,
) -> Result<Vec<SymbolRecord>> {
    let mut parser = parser_for_language(language)?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| anyhow!("failed to parse {file_path}"))?;

    let root = tree.root_node();
    let mut symbols = vec![build_symbol_record(
        SymbolContext {
            file_path,
            language,
            source,
            export_context: None,
        },
        SymbolKind::Module,
        file_path.to_string(),
        root,
        extract_module_doc_comment(source, language),
    )];

    match language {
        Language::Typescript => {
            collect_typescript_symbols(root, source, file_path, None, &mut symbols)?
        }
        Language::Python => collect_python_symbols(root, source, file_path, &mut symbols)?,
        Language::Rust => collect_rust_symbols(root, source, file_path, &mut symbols)?,
    }

    sort_symbols(&mut symbols);
    assign_stable_ids(&mut symbols);
    Ok(symbols)
}

pub fn index_source_files(root: &Path, files: &[PathBuf]) -> Result<Vec<SymbolRecord>> {
    let mut symbols = Vec::new();

    for file_path in files {
        let source = std::fs::read_to_string(file_path)?;
        let normalized_path = normalize_path(root, file_path);
        let language = language_for_path(file_path)?;
        symbols.extend(extract_symbols_from_source_with_language(
            &source,
            &normalized_path,
            language,
        )?);
    }

    sort_symbols(&mut symbols);
    Ok(symbols)
}

pub fn build_embedding_records(symbols: &[SymbolRecord]) -> Result<Vec<EmbeddingRecord>> {
    let mut records = Vec::with_capacity(symbols.len());

    for symbol in symbols {
        let export_fragment = if symbol.is_exported {
            match symbol.export_kind.as_deref() {
                Some(kind) => format!("export={kind}"),
                None => String::from("exported=true"),
            }
        } else {
            String::from("exported=false")
        };

        let signature_fragment = symbol.signature.clone().unwrap_or_default();
        let doc_fragment = symbol.doc_comment.clone().unwrap_or_default();
        let source_fragment = collapse_whitespace(&symbol.source_text);
        let text = format!(
            "language={} file={} kind={} name={} stable_symbol_id={} chunk_id={} {} signature={} doc_comment={} source_text={} lines={}-{}",
            symbol.language.as_str(),
            symbol.file_path,
            symbol.kind.as_str(),
            symbol.name,
            symbol.stable_symbol_id,
            symbol.chunk_id,
            export_fragment,
            signature_fragment,
            doc_fragment,
            source_fragment,
            symbol.range.start.line,
            symbol.range.end.line
        )
        .to_lowercase();

        records.push(EmbeddingRecord {
            language: symbol.language,
            file_path: symbol.file_path.clone(),
            kind: symbol.kind.clone(),
            name: symbol.name.clone(),
            stable_symbol_id: symbol.stable_symbol_id.clone(),
            chunk_id: symbol.chunk_id.clone(),
            signature: symbol.signature.clone(),
            doc_comment: symbol.doc_comment.clone(),
            source_text: symbol.source_text.clone(),
            is_exported: symbol.is_exported,
            has_doc_comment: symbol.has_doc_comment,
            text,
        });
    }

    Ok(records)
}

pub fn run_cli<I>(args: I) -> Result<String>
where
    I: IntoIterator<Item = OsString>,
{
    let args = CliArgs::try_parse_from(args)?;
    let root = std::fs::canonicalize(&args.root)?;
    let mut files = if args.files.is_empty() {
        collect_source_files(&root)?
    } else {
        args.files
            .into_iter()
            .map(|file_path| -> Result<PathBuf> {
                if file_path.is_absolute() {
                    ensure_file_within_root(&root, &file_path)
                } else {
                    ensure_file_within_root(&root, &root.join(file_path))
                }
            })
            .collect::<Result<Vec<_>>>()?
    };

    files.sort();

    let symbols = index_source_files(&root, &files)?;

    match args.format {
        OutputFormat::Json => Ok(serde_json::to_string_pretty(&symbols)?),
        OutputFormat::Jsonl => {
            let records = build_embedding_records(&symbols)?;
            let mut lines = Vec::with_capacity(records.len());
            for record in records {
                lines.push(serde_json::to_string(&record)?);
            }
            Ok(lines.join("\n"))
        }
    }
}

fn parser_for_language(language: Language) -> Result<Parser> {
    let mut parser = Parser::new();
    match language {
        Language::Typescript => parser
            .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
            .map_err(|error| anyhow!("failed to load TypeScript grammar: {error}"))?,
        Language::Python => parser
            .set_language(&tree_sitter_python::LANGUAGE.into())
            .map_err(|error| anyhow!("failed to load Python grammar: {error}"))?,
        Language::Rust => parser
            .set_language(&tree_sitter_rust::LANGUAGE.into())
            .map_err(|error| anyhow!("failed to load Rust grammar: {error}"))?,
    }

    Ok(parser)
}

fn collect_source_files(root: &Path) -> Result<Vec<PathBuf>> {
    let excluded_dirs = [".git", "node_modules", "target", "dist"];
    let mut files = Vec::new();

    let walker = WalkDir::new(root).into_iter().filter_entry(|entry| {
        if !entry.file_type().is_dir() {
            return true;
        }

        let relative_path = normalize_path(root, entry.path());
        let entry_name = entry.file_name().to_string_lossy();
        if excluded_dirs.contains(&entry_name.as_ref()) {
            return false;
        }

        if relative_path == ".github/sessions" || relative_path.starts_with(".github/sessions/") {
            return false;
        }

        if entry.depth() > 0
            && entry_name.starts_with('.')
            && entry_name != ".opencode"
            && entry_name != ".github"
        {
            return false;
        }

        true
    });

    for entry in walker {
        let entry = entry?;
        if entry.file_type().is_file() && is_supported_extension(entry.path()) {
            files.push(entry.path().to_path_buf());
        }
    }

    files.sort();
    Ok(files)
}

fn collect_typescript_symbols(
    node: Node<'_>,
    source: &str,
    file_path: &str,
    export_context: Option<ExportContext<'_>>,
    symbols: &mut Vec<SymbolRecord>,
) -> Result<()> {
    let context = SymbolContext {
        file_path,
        language: Language::Typescript,
        source,
        export_context,
    };

    match node.kind() {
        "export_statement" => {
            let export_context = Some(ExportContext {
                export_kind: "declaration",
            });
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                match child.kind() {
                    "export_clause" => {
                        collect_export_specifiers(child, source, file_path, symbols)?
                    }
                    "function_declaration"
                    | "class_declaration"
                    | "lexical_declaration"
                    | "variable_declaration" => collect_typescript_symbols(
                        child,
                        source,
                        file_path,
                        export_context,
                        symbols,
                    )?,
                    _ => {}
                }
            }
            return Ok(());
        }
        "function_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    symbols,
                    context,
                    SymbolKind::Function,
                    text_for_node(name_node, source),
                    node,
                );
            }
            return Ok(());
        }
        "class_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    symbols,
                    context,
                    SymbolKind::Class,
                    text_for_node(name_node, source),
                    node,
                );
            }
            return Ok(());
        }
        "lexical_declaration" | "variable_declaration" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if child.kind() == "variable_declarator" {
                    collect_variable_symbol(child, source, file_path, export_context, symbols);
                }
            }
            return Ok(());
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_typescript_symbols(child, source, file_path, export_context, symbols)?;
    }

    Ok(())
}

fn collect_python_symbols(
    node: Node<'_>,
    source: &str,
    file_path: &str,
    symbols: &mut Vec<SymbolRecord>,
) -> Result<()> {
    let context = SymbolContext {
        file_path,
        language: Language::Python,
        source,
        export_context: None,
    };

    match node.kind() {
        "function_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    symbols,
                    context,
                    SymbolKind::Function,
                    text_for_node(name_node, source),
                    node,
                );
            }
            return Ok(());
        }
        "class_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    symbols,
                    context,
                    SymbolKind::Class,
                    text_for_node(name_node, source),
                    node,
                );
            }
            return Ok(());
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_python_symbols(child, source, file_path, symbols)?;
    }

    Ok(())
}

fn collect_rust_symbols(
    node: Node<'_>,
    source: &str,
    file_path: &str,
    symbols: &mut Vec<SymbolRecord>,
) -> Result<()> {
    let context = SymbolContext {
        file_path,
        language: Language::Rust,
        source,
        export_context: None,
    };

    match node.kind() {
        "function_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    symbols,
                    SymbolContext {
                        export_context: rust_export_context(node, source),
                        ..context
                    },
                    SymbolKind::Function,
                    text_for_node(name_node, source),
                    node,
                );
            }
            return Ok(());
        }
        "struct_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    symbols,
                    SymbolContext {
                        export_context: rust_export_context(node, source),
                        ..context
                    },
                    SymbolKind::Struct,
                    text_for_node(name_node, source),
                    node,
                );
            }
            return Ok(());
        }
        "enum_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    symbols,
                    SymbolContext {
                        export_context: rust_export_context(node, source),
                        ..context
                    },
                    SymbolKind::Enum,
                    text_for_node(name_node, source),
                    node,
                );
            }
            return Ok(());
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_rust_symbols(child, source, file_path, symbols)?;
    }

    Ok(())
}

fn collect_export_specifiers(
    node: Node<'_>,
    source: &str,
    file_path: &str,
    symbols: &mut Vec<SymbolRecord>,
) -> Result<()> {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() != "export_specifier" {
            continue;
        }

        let name_node = child
            .child_by_field_name("alias")
            .or_else(|| child.child_by_field_name("name"))
            .or_else(|| {
                let mut spec_cursor = child.walk();
                child.named_children(&mut spec_cursor).next()
            });

        if let Some(name_node) = name_node {
            push_symbol(
                symbols,
                SymbolContext {
                    file_path,
                    language: Language::Typescript,
                    source,
                    export_context: Some(ExportContext {
                        export_kind: "named",
                    }),
                },
                SymbolKind::Export,
                text_for_node(name_node, source),
                child,
            );
        }
    }

    Ok(())
}

fn collect_variable_symbol(
    node: Node<'_>,
    source: &str,
    file_path: &str,
    export_context: Option<ExportContext<'_>>,
    symbols: &mut Vec<SymbolRecord>,
) {
    let Some(name_node) = node.child_by_field_name("name") else {
        return;
    };

    let Some(value_node) = node.child_by_field_name("value") else {
        if export_context.is_none() {
            return;
        }

        push_symbol(
            symbols,
            SymbolContext {
                file_path,
                language: Language::Typescript,
                source,
                export_context,
            },
            SymbolKind::Export,
            text_for_node(name_node, source),
            node,
        );
        return;
    };

    let symbol_kind = match value_node.kind() {
        "arrow_function" | "function_expression" => SymbolKind::Function,
        _ if export_context.is_some() => SymbolKind::Export,
        _ => return,
    };

    push_symbol(
        symbols,
        SymbolContext {
            file_path,
            language: Language::Typescript,
            source,
            export_context,
        },
        symbol_kind,
        text_for_node(name_node, source),
        node,
    );
}

fn push_symbol(
    symbols: &mut Vec<SymbolRecord>,
    context: SymbolContext<'_>,
    kind: SymbolKind,
    name: String,
    node: Node<'_>,
) {
    let doc_comment = extract_doc_comment(context.language, context.source, node);
    symbols.push(build_symbol_record(context, kind, name, node, doc_comment));
}

fn build_symbol_record(
    context: SymbolContext<'_>,
    kind: SymbolKind,
    name: String,
    node: Node<'_>,
    doc_comment: Option<String>,
) -> SymbolRecord {
    let range = to_range(node);
    let source_text = if matches!(kind, SymbolKind::Module) {
        context.source.trim().to_string()
    } else {
        text_for_node(node, context.source)
    };
    let signature = build_signature(&source_text, &kind);
    let has_doc_comment = doc_comment.is_some();

    SymbolRecord {
        language: context.language,
        file_path: context.file_path.to_string(),
        kind,
        name,
        stable_symbol_id: String::new(),
        chunk_id: String::new(),
        range,
        signature,
        doc_comment,
        source_text,
        is_exported: context.export_context.is_some(),
        export_kind: context
            .export_context
            .map(|export_context| export_context.export_kind.to_string()),
        has_doc_comment,
    }
}

fn rust_export_context(node: Node<'_>, source: &str) -> Option<ExportContext<'static>> {
    let node_text = text_for_node(node, source);
    let first_line = node_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim_start)?;

    if first_line.starts_with("pub ") || first_line.starts_with("pub(") {
        Some(ExportContext { export_kind: "pub" })
    } else {
        None
    }
}

fn text_for_node(node: Node<'_>, source: &str) -> String {
    node.utf8_text(source.as_bytes())
        .map(|text| text.trim().to_string())
        .unwrap_or_default()
}

fn normalize_path(root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative.to_string_lossy().replace('\\', "/")
}

fn ensure_file_within_root(root: &Path, file_path: &Path) -> Result<PathBuf> {
    let canonical_path = std::fs::canonicalize(file_path)?;
    if canonical_path.strip_prefix(root).is_err() {
        return Err(anyhow!(
            "refusing to read a source file outside the selected root: {}",
            file_path.display()
        ));
    }

    if !is_supported_extension(&canonical_path) {
        return Err(anyhow!(
            "only .ts, .py, and .rs files are supported: {}",
            file_path.display()
        ));
    }

    Ok(canonical_path)
}

fn language_for_path(path: &Path) -> Result<Language> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("ts") => Ok(Language::Typescript),
        Some("py") => Ok(Language::Python),
        Some("rs") => Ok(Language::Rust),
        _ => Err(anyhow!("unsupported source file: {}", path.display())),
    }
}

fn is_supported_extension(path: &Path) -> bool {
    language_for_path(path).is_ok()
}

fn extract_module_doc_comment(source: &str, language: Language) -> Option<String> {
    match language {
        Language::Typescript | Language::Rust => extract_top_doc_comment(source, language),
        Language::Python => extract_top_python_docstring(source),
    }
}

fn extract_doc_comment(language: Language, source: &str, node: Node<'_>) -> Option<String> {
    match language {
        Language::Typescript | Language::Rust => {
            extract_leading_doc_comment(source, node.start_byte(), language)
        }
        Language::Python => extract_python_block_docstring(&text_for_node(node, source)),
    }
}

fn extract_top_doc_comment(source: &str, language: Language) -> Option<String> {
    let mut lines = Vec::new();
    let mut collecting = false;

    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if collecting {
                break;
            }
            continue;
        }

        if is_doc_comment_line(trimmed, language) {
            collecting = true;
            lines.push(trimmed.to_string());
            continue;
        }

        break;
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn extract_leading_doc_comment(
    source: &str,
    start_byte: usize,
    language: Language,
) -> Option<String> {
    let prefix = &source[..start_byte.min(source.len())];
    let mut lines = Vec::new();

    for line in prefix.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }

        if is_doc_comment_line(trimmed, language) {
            lines.push(trimmed.to_string());
            continue;
        }

        break;
    }

    if lines.is_empty() {
        None
    } else {
        lines.reverse();
        Some(lines.join("\n"))
    }
}

fn extract_top_python_docstring(source: &str) -> Option<String> {
    let trimmed = source.trim_start();
    extract_quoted_docstring(trimmed)
}

fn extract_python_block_docstring(text: &str) -> Option<String> {
    let mut lines = text.lines();
    let _ = lines.next();
    let body = lines.collect::<Vec<_>>().join("\n");
    extract_quoted_docstring(body.trim_start())
}

fn extract_quoted_docstring(text: &str) -> Option<String> {
    for delimiter in ["\"\"\"", "'''"] {
        if let Some(rest) = text.strip_prefix(delimiter)
            && let Some(end_index) = rest.find(delimiter)
        {
            let end = delimiter.len() + end_index + delimiter.len();
            return Some(text[..end].trim().to_string());
        }
    }

    None
}

fn is_doc_comment_line(line: &str, language: Language) -> bool {
    match language {
        Language::Typescript => {
            line.starts_with("/**")
                || line.starts_with("///")
                || line.starts_with('*')
                || line.starts_with("*/")
        }
        Language::Rust => {
            line.starts_with("/**")
                || line.starts_with("///")
                || line.starts_with("//!")
                || line.starts_with('*')
                || line.starts_with("*/")
        }
        Language::Python => false,
    }
}

fn build_signature(source_text: &str, kind: &SymbolKind) -> Option<String> {
    if matches!(kind, SymbolKind::Module) {
        return None;
    }

    source_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn to_range(node: Node<'_>) -> Range {
    let start = node.start_position();
    let end = node.end_position();

    Range {
        start: Position {
            line: start.row + 1,
            column: start.column + 1,
            byte: node.start_byte(),
        },
        end: Position {
            line: end.row + 1,
            column: end.column + 1,
            byte: node.end_byte(),
        },
    }
}

fn sort_symbols(symbols: &mut [SymbolRecord]) {
    symbols.sort_by(|left, right| {
        left.file_path
            .cmp(&right.file_path)
            .then(left.range.start.byte.cmp(&right.range.start.byte))
            .then(left.name.cmp(&right.name))
    });
}

fn assign_stable_ids(symbols: &mut [SymbolRecord]) {
    let mut current_key: Option<(Language, String, &'static str, String)> = None;
    let mut occurrence = 0usize;

    for symbol in symbols {
        let key = (
            symbol.language,
            symbol.file_path.clone(),
            symbol.kind.as_str(),
            symbol.name.clone(),
        );

        if current_key.as_ref() == Some(&key) {
            occurrence += 1;
        } else {
            current_key = Some(key.clone());
            occurrence = 0;
        }

        let stable_symbol_id = format!(
            "{}:{}:{}:{}:{}",
            key.0.as_str(),
            key.1,
            key.2,
            key.3,
            occurrence
        );
        symbol.stable_symbol_id = stable_symbol_id.clone();
        symbol.chunk_id = format!("{stable_symbol_id}:chunk:0");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
"""Example python module."""

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
}
