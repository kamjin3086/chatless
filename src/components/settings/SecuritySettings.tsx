"use client";

import { WorkspaceSettings } from "./WorkspaceSettings";
import { FileSystemAuthSettings } from "./FileSystemAuthSettings";
import { NativeToolAuthSettings } from "./NativeToolAuthSettings";
import { ShellAuthSettings } from "./ShellAuthSettings";

export function SecuritySettings() {
  return (
    <div className="space-y-4">
      <NativeToolAuthSettings />
      <ShellAuthSettings />
      <WorkspaceSettings />
      <FileSystemAuthSettings />
    </div>
  );
}
