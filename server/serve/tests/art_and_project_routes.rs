//! The art marks and the default project end to end, over a folder of their own: a mark changed and the
//! file answered back, the project read fresh, saved as sent and read again, and every refusal - in the
//! plain text the page shows.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::json;
use std::path::{Path, PathBuf};
use tower::ServiceExt;

const PAGE: [(&str, &str); 3] = [("x-tactical-save", "1"), ("origin", "http://127.0.0.1:8420"), ("host", "127.0.0.1:8420")];

fn folder(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("tactical-archive-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("projects")).unwrap();
    root
}

async fn send(root: &Path, method: &str, path: &str, body: &str, page: bool) -> (StatusCode, String, Option<String>, Option<String>) {
    let mut request = Request::builder().method(method).uri(path);
    if page {
        for (name, value) in PAGE {
            request = request.header(name, value);
        }
    }
    let response = serve::app(root.to_path_buf()).oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let header = |name: &str| response.headers().get(name).map(|v| v.to_str().unwrap().to_string());
    let (status, kind, cache) = (response.status(), header("content-type"), header("cache-control"));
    let text = String::from_utf8(response.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap();
    (status, text, kind, cache)
}

#[tokio::test]
async fn the_default_project_is_read_fresh_and_saved_as_sent() {
    let root = folder("project");
    assert_eq!(send(&root, "GET", "/projects/default.json", "", false).await.0, StatusCode::NOT_FOUND);

    let project = "{\n  \"id\": \"p\",\n  \"scenes\": [{ \"id\": \"hall\" }]\n}";
    let saved = send(&root, "POST", "/__project/save", project, true).await;
    assert_eq!((saved.0, saved.1.as_str()), (StatusCode::NO_CONTENT, ""));
    // The text as sent, with the newline a file ends in.
    assert_eq!(std::fs::read_to_string(root.join("projects/default.json")).unwrap(), format!("{project}\n"));

    let read = send(&root, "GET", "/projects/default.json", "", false).await;
    assert_eq!((read.0, read.1, read.2.as_deref(), read.3.as_deref()), (StatusCode::OK, format!("{project}\n"), Some("application/json"), Some("no-store")));
    let head = send(&root, "HEAD", "/projects/default.json", "", false).await;
    assert_eq!((head.0, head.1.as_str()), (StatusCode::OK, ""));
    assert_eq!(send(&root, "POST", "/projects/default.json", "{}", true).await.0, StatusCode::NOT_FOUND);

    for (method, body, page, status, reason) in [
        ("GET", project, true, 405, "a save is a POST"),
        ("POST", project, false, 403, "not sent by the page"),
        ("POST", "not json", true, 400, "not JSON"),
        ("POST", "{\"id\":\"p\",\"scenes\":[]}", true, 422, "not a project: no id, or no scenes"),
    ] {
        let refused = send(&root, method, "/__project/save", body, page).await;
        assert_eq!((refused.0.as_u16(), refused.1.as_str()), (status, reason), "{method} {body}");
    }
    // Refused saves leave the file as it was.
    assert_eq!(std::fs::read_to_string(root.join("projects/default.json")).unwrap(), format!("{project}\n"));
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn a_mark_is_kept_and_the_marks_answered_back() {
    let root = folder("marks");
    let marked = send(&root, "POST", "/__art/provenance", &json!({ "key": "model:arty", "provenance": "ai-assisted" }).to_string(), true).await;
    assert_eq!((marked.0, marked.2.as_deref()), (StatusCode::OK, Some("application/json")));
    assert_eq!(serde_json::from_str::<serde_json::Value>(&marked.1).unwrap(), json!({ "model:arty": "ai-assisted" }));
    send(&root, "POST", "/__art/provenance", &json!({ "key": "model:Apple", "provenance": "human-made" }).to_string(), true).await;
    assert_eq!(
        std::fs::read_to_string(root.join("projects/art-provenance.json")).unwrap(),
        "{\n  \"model:Apple\": \"human-made\",\n  \"model:arty\": \"ai-assisted\"\n}\n"
    );
    let back = send(&root, "POST", "/__art/provenance", &json!({ "key": "model:arty", "provenance": null }).to_string(), true).await;
    assert_eq!(serde_json::from_str::<serde_json::Value>(&back.1).unwrap(), json!({ "model:Apple": "human-made" }));

    for (body, page, status, reason) in [
        (json!({ "key": "model:arty", "provenance": "robot" }).to_string(), true, 422, "not AI generated, AI assisted, human made, or nothing"),
        (json!({ "key": "thing:arty", "provenance": "human-made" }).to_string(), true, 422, "not a piece of art the engine knows how to name"),
        ("x".repeat(5000), true, 413, "too large to be one mark"),
        ("{}".to_string(), false, 403, "not sent by the page"),
    ] {
        let refused = send(&root, "POST", "/__art/provenance", &body, page).await;
        assert_eq!((refused.0.as_u16(), refused.1.as_str()), (status, reason));
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn the_lists_the_page_loads_are_read_on_every_request() {
    let root = folder("lists");
    std::fs::create_dir_all(root.join("public/models")).unwrap();
    std::fs::write(root.join("public/models/Quim.glb"), b"glTF").unwrap();
    std::fs::write(root.join("projects/model-ancestries.json"), r#"{ "quim": "dwarf" }"#).unwrap();
    let models = send(&root, "GET", "/__models/shipped", "", false).await;
    assert_eq!((models.0, models.2.as_deref(), models.3.as_deref()), (StatusCode::OK, Some("application/json"), Some("no-store")));
    assert_eq!(serde_json::from_str::<serde_json::Value>(&models.1).unwrap(), json!([{ "id": "quim", "url": "/models/Quim.glb", "scale": 1, "ancestry": "dwarf" }]));
    // A model added, an ancestry changed: the next request has them.
    std::fs::write(root.join("public/models/Arty.glb"), b"glTF").unwrap();
    std::fs::write(root.join("projects/model-ancestries.json"), r#"{ "quim": "human" }"#).unwrap();
    let again: serde_json::Value = serde_json::from_str(&send(&root, "GET", "/__models/shipped", "", false).await.1).unwrap();
    assert_eq!(again, json!([{ "id": "arty", "url": "/models/Arty.glb", "scale": 1 }, { "id": "quim", "url": "/models/Quim.glb", "scale": 1, "ancestry": "human" }]));

    assert_eq!(send(&root, "GET", "/__art/marks", "", false).await.1, "{}");
    std::fs::write(root.join("projects/art-provenance.json"), r#"{ "model:arty": "ai-assisted", "bad": "x" }"#).unwrap();
    let marks = send(&root, "GET", "/__art/marks", "", false).await;
    assert_eq!((marks.0, marks.1.as_str(), marks.3.as_deref()), (StatusCode::OK, r#"{"model:arty":"ai-assisted"}"#, Some("no-store")));
    // Reading is all they do.
    assert_eq!(send(&root, "POST", "/__art/marks", "{}", true).await.0, StatusCode::METHOD_NOT_ALLOWED);
    let _ = std::fs::remove_dir_all(&root);
}

