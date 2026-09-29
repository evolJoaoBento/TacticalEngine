//! `tactical-serve [--root <repository>] [--host 127.0.0.1] [--port 8430]`
//!
//! Started by the Vite dev server (`tools/rust-server.ts`), which passes the moved routes through to
//! it; or by hand, `npm run server`. It keeps its files under `--root`, the repository by default.

use std::net::SocketAddr;
use std::path::PathBuf;

fn argument(name: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == name {
            return args.next();
        }
    }
    None
}

#[tokio::main]
async fn main() {
    let root = argument("--root").map(PathBuf::from).unwrap_or_else(|| std::env::current_dir().expect("a working directory"));
    let host = argument("--host").unwrap_or_else(|| "127.0.0.1".into());
    let port: u16 = argument("--port").and_then(|port| port.parse().ok()).unwrap_or(8430);
    let address: SocketAddr = format!("{host}:{port}").parse().expect("a host and a port");
    let listener = match tokio::net::TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("tactical-serve: could not listen on {address}: {error}");
            std::process::exit(1);
        }
    };
    println!("tactical-serve: listening on http://{address}, keeping files under {}", root.display());
    axum::serve(listener, serve::app(root))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("the server");
}
