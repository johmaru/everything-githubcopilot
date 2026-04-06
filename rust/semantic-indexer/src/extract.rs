use tree_sitter::Node;

use anyhow::Result;

use crate::metadata::{
    build_signature, extract_doc_comment, extract_module_doc_comment, summarize_module_source,
};
use crate::model::{Language, Position, Range, SymbolKind, SymbolRecord};

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

pub(crate) fn collect_symbols(
    root: Node<'_>,
    source: &str,
    file_path: &str,
    language: Language,
) -> Result<Vec<SymbolRecord>> {
    let context = SymbolContext {
        file_path,
        language,
        source,
        export_context: None,
    };
    let mut symbols = vec![build_module_symbol(context, root)];

    match language {
        Language::Typescript => {
            collect_typescript_symbols(root, source, file_path, None, &mut symbols)?
        }
        Language::Python => collect_python_symbols(root, source, file_path, &mut symbols)?,
        Language::Rust => collect_rust_symbols(root, source, file_path, &mut symbols)?,
    }

    Ok(symbols)
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
    let source_text = text_for_node(node, context.source);
    let doc_comment = extract_doc_comment(
        context.language,
        context.source,
        node.start_byte(),
        &source_text,
    );
    symbols.push(build_symbol_record(
        context,
        kind,
        name,
        node,
        source_text,
        doc_comment,
    ));
}

fn build_module_symbol(context: SymbolContext<'_>, node: Node<'_>) -> SymbolRecord {
    let source_text = summarize_module_source(context.source, context.language);
    let doc_comment = extract_module_doc_comment(context.source, context.language);
    build_symbol_record(
        context,
        SymbolKind::Module,
        context.file_path.to_string(),
        node,
        source_text,
        doc_comment,
    )
}

fn build_symbol_record(
    context: SymbolContext<'_>,
    kind: SymbolKind,
    name: String,
    node: Node<'_>,
    source_text: String,
    doc_comment: Option<String>,
) -> SymbolRecord {
    let range = to_range(node);
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
