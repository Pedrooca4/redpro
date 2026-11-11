import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { BenchError } from "./local.ts";

export async function privateDirectory(path: string) {
  if (!process.getuid || !isAbsolute(path) || (await realpath(path)) !== resolve(path)) {
    throw new BenchError("Use uma pasta privada POSIX, absoluta e sem links simbólicos.");
  }
  const canonical = resolve(path);
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) {
    throw new BenchError("A pasta privada deve pertencer ao usuário atual e ter permissão 0700.");
  }
  for (let current = canonical; ; current = dirname(current)) {
    const git = await lstat(resolve(current, ".git")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (git) throw new BenchError("Use uma pasta privada fora de qualquer checkout Git.");
    if (current === dirname(current)) return canonical;
  }
}

export async function readPrivateFile(path: string, limit: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o600 ||
      info.size > limit
    ) {
      throw new BenchError("Arquivo privado deve ser regular, próprio, 0600 e respeitar o limite.");
    }
    // Read a bounded snapshot from the same descriptor used for checks and hashing.
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > limit) throw new BenchError("Arquivo privado excede o limite.");
    return buffer.subarray(0, size);
  } finally {
    await file.close();
  }
}

export async function syncDirectory(directory: string) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writePrivateJSON(path: string, value: unknown) {
  const temporary = resolve(dirname(path), `.pending-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    // An exclusive link publishes a complete file atomically, without replacing an earlier result.
    await link(temporary, path);
  } finally {
    await unlink(temporary);
  }
  await syncDirectory(dirname(path));
}
