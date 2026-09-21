"use client";

import { WorkspaceSettings } from "./WorkspaceSettings";
import { FileSystemAuthSettings } from "./FileSystemAuthSettings";
import { ShellAccessSettings } from "./ShellAccessSettings";

export function SecuritySettings() {
  return (
    <>
      <ShellAccessSettings />
      <WorkspaceSettings />
      <FileSystemAuthSettings />
    </>
  );
}
