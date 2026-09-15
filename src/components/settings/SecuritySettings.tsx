"use client";

import { WorkspaceSettings } from "./WorkspaceSettings";
import { FileSystemAuthSettings } from "./FileSystemAuthSettings";
import { ShellAuthSettings } from "./ShellAuthSettings";

export function SecuritySettings() {
  return (
    <>
      <ShellAuthSettings />
      <WorkspaceSettings />
      <FileSystemAuthSettings />
    </>
  );
}
