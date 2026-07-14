export {}

const commands: Record<string, string> = {
  capture: './capture-screenshots.ts',
  compare: './compare-screenshots.ts',
  process: './process-screenshot.ts',
  promote: './promote-screenshots.ts',
  verify: './verify-screenshots.ts'
}

const usage = `Usage: pnpm screenshots <command> [options]

Commands:
  capture   Capture candidates from the open Figma tab
  compare   Generate the baseline comparison report
  promote   Replace committed assets after review
  verify    Validate the manifest and committed assets
  process   Process one source image (advanced)`

const command = process.argv[2]

if (!command || command === '--help' || command === '-h') {
  console.log(usage)
} else {
  const modulePath = commands[command]
  if (!modulePath) {
    console.error(`Unknown screenshot command: ${command}\n\n${usage}`)
    process.exitCode = 1
  } else {
    process.argv.splice(2, 1)
    await import(modulePath)
  }
}
