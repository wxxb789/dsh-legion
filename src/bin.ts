#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { runCli } from './cli.ts'

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  readTextFile: path => readFile(path, 'utf8'),
})
