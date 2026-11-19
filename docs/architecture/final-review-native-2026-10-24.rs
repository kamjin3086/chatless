// Run through final-review-native-2026-10-24.py; imports production code unchanged.
#[path = "../../src-tauri/src/filesystem/state.rs"]
mod state;
fn main() {
  tokio::runtime::Runtime::new().unwrap().block_on(async {
    let root = std::env::temp_dir().join(format!("chatless-grant-review-{}", std::process::id()));
    let data = root.join("app");
    let target = root.join("secret.txt");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(&target, "fixture only").unwrap();
    let fs = state::FilesystemAllowlistState::default();
    let path = target.to_str().unwrap();
    assert!(fs.assert_allowed(&data, path, state::FsOp::Read).await.is_err());
    fs.grant_call_scope("run-A", Some("call-A"), path,
      state::FsPermissions { read: true, ..Default::default() }, 60000).await.unwrap();
    // Real command authorization has no caller identity parameter at all.
    let unscoped_access = fs.assert_allowed(&data, path, state::FsOp::Read).await;
    println!("outside-call identity check while A grant exists: {:?}", unscoped_access);
    fs.revoke_call_scope("run-B", Some("call-B")).await.unwrap();
    assert!(fs.assert_allowed(&data, path, state::FsOp::Read).await.is_ok());
    fs.revoke_call_scope("run-A", Some("call-A")).await.unwrap();
    assert!(fs.assert_allowed(&data, path, state::FsOp::Read).await.is_err());
    std::fs::remove_dir_all(&root).unwrap();
    assert!(unscoped_access.is_err(), "one-call grant authorized an operation without matching caller identity");
  });
}
