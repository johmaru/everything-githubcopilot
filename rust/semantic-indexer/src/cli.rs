use std::ffi::OsString;
use std::path::PathBuf;

use anyhow::Result;
use clap::Parser as ClapParser;
use clap::ValueEnum;

use crate::discovery::{collect_source_files, ensure_file_within_root};
use crate::embedding::build_embedding_records;
use crate::indexer::index_source_files;

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
