use anyhow::Result;
use anyhow::anyhow;
use tree_sitter::Parser;

use crate::model::Language;

#[derive(Default)]
pub(crate) struct ParserSet {
    typescript: Option<Parser>,
    python: Option<Parser>,
    rust: Option<Parser>,
}

impl ParserSet {
    pub(crate) fn parser_for(&mut self, language: Language) -> Result<&mut Parser> {
        match language {
            Language::Typescript => {
                if self.typescript.is_none() {
                    self.typescript = Some(build_parser(language)?);
                }
                Ok(self
                    .typescript
                    .as_mut()
                    .expect("typescript parser should exist"))
            }
            Language::Python => {
                if self.python.is_none() {
                    self.python = Some(build_parser(language)?);
                }
                Ok(self.python.as_mut().expect("python parser should exist"))
            }
            Language::Rust => {
                if self.rust.is_none() {
                    self.rust = Some(build_parser(language)?);
                }
                Ok(self.rust.as_mut().expect("rust parser should exist"))
            }
        }
    }
}

fn build_parser(language: Language) -> Result<Parser> {
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
