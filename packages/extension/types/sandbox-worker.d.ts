declare module '*?sandbox-worker' {
  const WorkerConstructor: {
    new (options?: WorkerOptions): Worker
  }

  export default WorkerConstructor
}
