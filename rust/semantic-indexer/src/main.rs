fn main() {
    match semantic_indexer::run_cli(std::env::args_os()) {
        Ok(output) => print!("{output}"),
        Err(error) => {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
    }
}
