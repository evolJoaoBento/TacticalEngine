//! `tactical-serve [--root <repository>] [--site <built client>] [--host 127.0.0.1] [--port 8430] [--dice-from-page]`
//!
//! Started by the Vite dev server (`tools/rust-server.ts`), which passes the routes through to it; or on
//! its own - `npm run build:server`, then `npm run server` - when it serves the game itself: the built
//! client from `--site` (`dist-server` by default) and the assets live from `public/`. It keeps its files
//! under `--root`, the repository by default. `--dice-from-page` is the tests' (`tests/e2e/server-mode.ts`): a
//! game opened takes the page's dice rather than the server's own seed, so the suite rolls what it was written for.

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
    let site = argument("--site").map(PathBuf::from).unwrap_or_else(|| root.join(serve::SITE));
    let address: SocketAddr = format!("{host}:{port}").parse().expect("a host and a port");
    let listener = match tokio::net::TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("tactical-serve: could not listen on {address}: {error}");
            std::process::exit(1);
        }
    };
    // The game itself when there is a built client to serve; the routes alone when there is not.
    let serves_the_game = site.join("index.html").is_file();
    // The private card art only to this machine: never when the server listens beyond it.
    let private_art = address.ip().is_loopback();
    let settings = serve::Settings { dice_from_page: std::env::args().any(|arg| arg == "--dice-from-page") };
    let app = if serves_the_game { serve::site(root.clone(), site.clone(), private_art) } else { serve::app_with(root.clone(), settings) };
    println!("tactical-serve: listening on http://{address}, keeping files under {}", root.display());
    if serves_the_game {
        println!("tactical-serve: serving the game from {} - open http://{address}/", site.display());
        if !private_art {
            println!("tactical-serve: listening beyond this machine, so the private card art in public/cards is not served");
        }
    }
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("the server");
}
